'use strict';
/*
 * Relay of the self-hosted co-browsing of the FreeScout Cobrowse module (rrweb, view only, no remote control).
 *
 *   customer (website, website/cobrowse.js)  <──>  relay  <──>  agent (FreeScout, /cobrowse/agent)
 *
 * - The customer opens `wss://<your relay>/cobrowse/ws?role=client`: the relay gives a 6-digit code (and a resume key).
 * - The agent opens `…?role=agent&code=<code>&token=<token>`; the token is signed by FreeScout with the shared secret
 *   (HMAC-SHA256, `base64url(payload).base64url(signature)`, payload JSON {n: agent name, exp: unix time}).
 * - The relay tells the customer (`agent`), who is asked to accept; once accepted (`consent`), the customer's page is
 *   recorded with rrweb and its events (`ev`) are passed to the agent as they are.
 * - The agent sends a pointer (`pointer`) and clicks (`click`), drawn on the customer's page. Nothing is clicked there.
 * - Once accepted, the customer also sends what its browser says about itself (`info`: user agent, window and screen
 *   size, zoom, touch, language, time zone), passed to the agent for the "Device" panel.
 * - Page change on the customer's side: the website reconnects with `resume=<code>&key=<key>` within 20 s and sends a
 *   full snapshot of the new page.
 * - Nothing is stored: a session lives while the customer is connected (10 minutes at most without an agent).
 *
 * Environment:
 *   COBROWSE_PORT            listening port on 127.0.0.1 (8095); put a reverse proxy with WebSocket support in front
 *   COBROWSE_SECRET_FILE     file holding the shared secret, 32 characters or more (~/.cobrowse-secret)
 *   COBROWSE_CLIENT_ORIGINS  origins allowed for customers, comma-separated (https://www.example.com)
 *   COBROWSE_AGENT_ORIGINS   origins allowed for agents: your FreeScout (https://helpdesk.example.com)
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {WebSocketServer} = require('ws');

const PORT = parseInt(process.env.COBROWSE_PORT || '8095', 10);
const SECRET_FILE = process.env.COBROWSE_SECRET_FILE || path.join(process.env.HOME || '.', '.cobrowse-secret');
const CLIENT_ORIGINS = (process.env.COBROWSE_CLIENT_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const AGENT_ORIGINS = (process.env.COBROWSE_AGENT_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!CLIENT_ORIGINS.length || !AGENT_ORIGINS.length) {
    throw new Error('set COBROWSE_CLIENT_ORIGINS (your website) and COBROWSE_AGENT_ORIGINS (your FreeScout)');
}
const MAX_SESSIONS = 50;
const WAIT_AGENT_MS = 10 * 60 * 1000;
const MAX_MESSAGE = 16 * 1024 * 1024;
const RESUME_MS = 20 * 1000;
const MAX_INFO = 4096;

const secret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
if (secret.length < 32) {
    throw new Error('secret too short in ' + SECRET_FILE);
}

/** @type {Map<string, {key: string, client: any, agent: any|null, agentName: string, consent: boolean, info: string|null, timer: any, away: any}>} */
const sessions = new Map();

function log(...a) {
    console.log(new Date().toISOString(), ...a);
}

function send(ws, msg) {
    if (ws && ws.readyState === 1) {
        ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
}

function newCode() {
    for (let i = 0; i < 20; i++) {
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        if (!sessions.has(code)) {
            return code;
        }
    }
    return null;
}

function b64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Agent token signed by FreeScout: `base64url(JSON).base64url(hmac)`. Returns the agent name, or null. */
function verifyToken(token) {
    if (typeof token !== 'string' || token.indexOf('.') < 0) {
        return null;
    }
    const [payload, sig] = token.split('.', 2);
    const expected = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return null;
    }
    try {
        const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        if (typeof data.exp !== 'number' || data.exp < Date.now() / 1000) {
            return null;
        }
        return String(data.n || 'Agent').slice(0, 60);
    } catch (e) {
        return null;
    }
}

function endSession(code, reason) {
    const s = sessions.get(code);
    if (!s) {
        return;
    }
    sessions.delete(code);
    clearTimeout(s.timer);
    clearTimeout(s.away);
    send(s.client, {t: 'end', reason});
    send(s.agent, {t: 'end', reason});
    try { s.client.close(); } catch (e) { /* already closed */ }
    try { s.agent && s.agent.close(); } catch (e) { /* already closed */ }
    log('end', code, reason);
}

const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/cobrowse/health' ? 200 : 404, {'Content-Type': 'text/plain'});
    res.end(req.url === '/cobrowse/health' ? 'ok ' + sessions.size : 'not found');
});
const wss = new WebSocketServer({noServer: true, maxPayload: MAX_MESSAGE, perMessageDeflate: true});

server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const role = url.searchParams.get('role');
    const origin = req.headers.origin || '';
    if (url.pathname !== '/cobrowse/ws'
        || (role === 'client' && !CLIENT_ORIGINS.includes(origin))
        || (role === 'agent' && !AGENT_ORIGINS.includes(origin))
        || (role !== 'client' && role !== 'agent')) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        if (role === 'client') {
            onClient(ws, url.searchParams.get('resume') || '', url.searchParams.get('key') || '');
        } else {
            onAgent(ws, url.searchParams.get('code') || '', url.searchParams.get('token') || '');
        }
    });
});

function onClient(ws, resume, key) {
    let code;
    let s;
    const old = resume ? sessions.get(resume) : null;
    if (old && key.length === old.key.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(old.key))) {
        // same session, new page
        code = resume;
        s = old;
        clearTimeout(s.away);
        if (s.client && s.client !== ws) {
            s.client.removeAllListeners('close');
            try { s.client.close(); } catch (e) { /* already closed */ }
        }
        s.client = ws;
        send(ws, {t: 'resumed', code, consent: s.consent, agent: !!s.agent, name: s.agentName});
        send(s.agent, {t: 'clientback'});
        log('client back', code);
    } else {
        if (resume) {
            send(ws, {t: 'end', reason: 'expired'});
            ws.close();
            return;
        }
        if (sessions.size >= MAX_SESSIONS) {
            send(ws, {t: 'error', error: 'busy'});
            ws.close();
            return;
        }
        code = newCode();
        if (!code) {
            ws.close();
            return;
        }
        s = {key: b64url(crypto.randomBytes(18)), client: ws, agent: null, agentName: '', consent: false, info: null, timer: null, away: null};
        s.timer = setTimeout(() => { if (!s.agent) endSession(code, 'timeout'); }, WAIT_AGENT_MS);
        sessions.set(code, s);
        send(ws, {t: 'code', code, key: s.key});
        log('client', code);
    }

    ws.on('message', (data, isBinary) => {
        if (isBinary || s.client !== ws) {
            return;
        }
        const text = data.toString();
        // rrweb events are passed on as they are, without being parsed
        if (text.startsWith('{"t":"ev"')) {
            if (s.consent) {
                send(s.agent, text);
            }
            return;
        }
        let msg;
        try { msg = JSON.parse(text); } catch (e) { return; }
        if (msg.t === 'consent') {
            s.consent = msg.ok === true;
            send(s.agent, {t: 'consent', ok: s.consent});
            if (!s.consent) {
                endSession(code, 'refused');
            }
        } else if (msg.t === 'info' && s.consent && msg.i && typeof msg.i === 'object' && !Array.isArray(msg.i)) {
        // the customer's browser, system and screen, for the agent's "Device" panel: passed on once the session is
        // accepted, and kept (in memory only) for an agent who reconnects
            const info = JSON.stringify({t: 'info', i: msg.i});
            if (info.length <= MAX_INFO) {
                s.info = info;
                send(s.agent, info);
            }
        } else if (msg.t === 'end') {
            endSession(code, 'client');
        }
    });
    ws.on('close', () => {
        if (s.client !== ws || sessions.get(code) !== s) {
            return;
        }
        // page left: wait for the next one
        send(s.agent, {t: 'clientaway'});
        s.away = setTimeout(() => endSession(code, 'client-closed'), RESUME_MS);
    });
}

function onAgent(ws, code, token) {
    const name = verifyToken(token);
    const s = sessions.get(code);
    if (!name || !s) {
        send(ws, {t: 'error', error: name ? 'code' : 'token'});
        ws.close();
        return;
    }
    if (s.agent && s.agent !== ws) {
        send(s.agent, {t: 'end', reason: 'replaced'});
        try { s.agent.close(); } catch (e) { /* already closed */ }
    }
    s.agent = ws;
    s.agentName = name;
    clearTimeout(s.timer);
    log('agent', code, name);
    if (s.consent) {
        // agent back: the session is already accepted, a full snapshot of the page is needed
        send(ws, {t: 'consent', ok: true});
        if (s.info) {
            send(ws, s.info);
        }
        send(s.client, {t: 'snapshot'});
    } else {
        send(s.client, {t: 'agent', name});
        send(ws, {t: 'waiting'});
    }

    ws.on('message', (data, isBinary) => {
        if (isBinary || s.agent !== ws) {
            return;
        }
        let msg;
        try { msg = JSON.parse(data.toString()); } catch (e) { return; }
        if (msg.t === 'pointer' && s.consent) {
            send(s.client, {t: 'pointer', on: !!msg.on, x: +msg.x || 0, y: +msg.y || 0});
        } else if (msg.t === 'click' && s.consent) {
            send(s.client, {t: 'click', x: +msg.x || 0, y: +msg.y || 0});
        } else if (msg.t === 'snapshot' && s.consent) {
            send(s.client, {t: 'snapshot'});
        } else if (msg.t === 'end') {
            endSession(code, 'agent');
        }
    });
    ws.on('close', () => {
        if (s.agent === ws && sessions.get(code) === s) {
            s.agent = null;
            send(s.client, {t: 'agentleft'});
            log('agent left', code);
        }
    });
}

setInterval(() => {
    for (const ws of wss.clients) {
        if (!ws.isAlive) {
            ws.terminate();
            continue;
        }
        ws.isAlive = false;
        ws.ping();
    }
}, 30000);

server.listen(PORT, '127.0.0.1', () => log('relay listening on 127.0.0.1:' + PORT));
