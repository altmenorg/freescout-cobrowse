/*!
 * Self-hosted co-browsing for the FreeScout Cobrowse module — website side (AGPL-3.0).
 * https://github.com/altmenorg/freescout-cobrowse
 *
 * Add to every page of your website, after rrweb's recorder is reachable (it is loaded only when a session starts):
 *
 *   <script defer src="/cobrowse/cobrowse.js"
 *           data-relay="wss://www.example.com/cobrowse/ws"
 *           data-record="/cobrowse/rrweb-record-2.2.0.js"
 *           data-lang="en"></script>
 *   <a href="#" data-cobrowse-code>Get an assistance code</a> <span data-cobrowse-code-value></span>
 *
 * Flow: the customer clicks the link and reads the 6-digit code to the agent; the agent types it in FreeScout; the
 * customer is asked to accept; the page is then sent to the agent (rrweb) until either side ends the session. The agent
 * cannot act on the page: a pointer is shown while the agent holds the left button down, and a ripple on each click.
 * Once the customer has accepted, the agent is also told which browser, system and screen the customer uses (what the
 * browser says about itself: user agent, window and screen size, zoom, touch, language, time zone).
 *
 * Options (attributes of the script tag):
 *   data-relay        WebSocket address of the relay (required)
 *   data-record       address of rrweb's recorder, website/rrweb-record-2.2.0.js (default: /cobrowse/rrweb-record-2.2.0.js)
 *   data-lang         "en" (default) or "fr"
 *   data-trigger      selector of the link that shows a code (default: [data-cobrowse-code], a.cobrowsegetcode)
 *   data-code         selector of the element that shows the code (default: [data-cobrowse-code-value], #cobrowsecode)
 *   data-consent      selector of your own consent dialog (optional): it gets the class "is-open" while asking,
 *                     its .cobrowse-consent__allow button accepts, .cobrowse-consent__deny / __close / __background refuse
 *   data-mask-inputs  "all" to mask every input field; by default only passwords are masked
 *   data-color        main color of the dialog, bar and pointer (default #d72d30)
 *
 * The session follows the customer from page to page (sessionStorage, resumed within 20 s by the relay).
 * Fonts and images of your pages are loaded by the agent's browser from your website: see "CORS" in the README.
 */
(function () {
    'use strict';
    var script = document.currentScript;
    var attr = function (name, dflt) { return (script && script.getAttribute(name)) || dflt; };
    var RELAY = attr('data-relay', '');
    if (!RELAY || !window.WebSocket) {
        return;
    }
    var RECORD_JS = attr('data-record', '/cobrowse/rrweb-record-2.2.0.js');
    var TRIGGER = attr('data-trigger', '[data-cobrowse-code], a.cobrowsegetcode');
    var CODE = attr('data-code', '[data-cobrowse-code-value], #cobrowsecode');
    var CONSENT = attr('data-consent', '');
    var MASK_ALL = attr('data-mask-inputs', '') === 'all';
    var COLOR = attr('data-color', '#d72d30');
    var STORE = 'freescout_cobrowse';

    var TEXTS = {
        en: {
            title: 'Screen sharing request',
            text: 'Do you agree to share the view of your screen with our support agent?',
            note: 'The agent can follow your session but cannot act on your computer.',
            allow: 'Allow', deny: 'Decline', close: 'Close',
            live: 'Assistance in progress', end: 'End'
        },
        fr: {
            title: 'Demande de session',
            text: 'Acceptez-vous de partager la vue de votre écran avec l’opérateur ?',
            note: 'Il pourra suivre votre session sans intervenir sur votre ordinateur.',
            allow: 'Autoriser', deny: 'Refuser', close: 'Fermer',
            live: 'Assistance en cours', end: 'Terminer'
        }
    };
    var T = TEXTS[attr('data-lang', 'en')] || TEXTS.en;

    var ws = null;
    var state = null; // {code, key, consent}
    var stopRecord = null;
    var ui = {};

    /* ---------------------------------------------------------------- styles (one file, no stylesheet to add) */

    function injectStyles() {
        if (document.getElementById('fs-cb-styles')) {
            return;
        }
        var css = ''
            + '.fs-cb-ui{font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;box-sizing:border-box}'
            + '.fs-cb-modal{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)}'
            + '.fs-cb-modal__box{position:relative;width:90%;max-width:400px;padding:40px 28px 26px;border-radius:8px;background:#fff;color:#1d1d1d;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.3)}'
            + '.fs-cb-modal__close{position:absolute;top:12px;right:12px;width:28px;height:28px;border:0;background:none;font-size:22px;line-height:1;color:#777;cursor:pointer}'
            + '.fs-cb-modal__title{margin:0 0 12px;font-size:18px;font-weight:700}'
            + '.fs-cb-modal p{margin:0 0 8px}.fs-cb-modal .fs-cb-note{margin-bottom:20px;color:#666;font-size:13px}'
            + '.fs-cb-modal__actions{display:flex;gap:12px}.fs-cb-modal__actions button{flex:1;height:40px;border:0;border-radius:5px;font:inherit;font-weight:700;cursor:pointer}'
            + '.fs-cb-deny{background:#eee;color:#1d1d1d}.fs-cb-allow{background:' + COLOR + ';color:#fff}'
            + '.fs-cb-bar{position:fixed;left:50%;bottom:16px;z-index:2147483000;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:8px 8px 8px 14px;border-radius:24px;background:#161515;color:#fff;font-weight:600;box-shadow:0 6px 24px rgba(0,0,0,.25)}'
            + '.fs-cb-bar__dot{width:9px;height:9px;border-radius:50%;background:' + COLOR + ';animation:fs-cb-blink 1.4s infinite}'
            + '.fs-cb-bar button{border:0;border-radius:16px;background:' + COLOR + ';color:#fff;font:inherit;padding:6px 14px;cursor:pointer}'
            + '@keyframes fs-cb-blink{50%{opacity:.35}}'
            + '.fs-cb-pointer{position:fixed;left:-8px;top:-8px;z-index:2147483001;width:16px;height:16px;border-radius:50%;background:' + COLOR + '8c;border:2px solid ' + COLOR + ';box-shadow:0 0 0 2px rgba(255,255,255,.8);pointer-events:none;transition:transform 60ms linear;display:none}'
            + '.fs-cb-click{position:fixed;z-index:2147483001;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid ' + COLOR + ';pointer-events:none;animation:fs-cb-ripple .9s ease-out forwards}'
            + '@keyframes fs-cb-ripple{to{transform:scale(4);opacity:0}}';
        var style = document.createElement('style');
        style.id = 'fs-cb-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    /* ---------------------------------------------------------------- storage, relay */

    function save() {
        try {
            if (state) {
                sessionStorage.setItem(STORE, JSON.stringify(state));
            } else {
                sessionStorage.removeItem(STORE);
            }
        } catch (e) { /* private browsing */ }
    }

    function load() {
        try {
            return JSON.parse(sessionStorage.getItem(STORE) || 'null');
        } catch (e) {
            return null;
        }
    }

    function send(msg) {
        if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify(msg));
        }
    }

    function loadRecorder() {
        if (window.rrwebRecord) {
            return Promise.resolve(window.rrwebRecord);
        }
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = RECORD_JS;
            s.onload = function () { resolve(window.rrwebRecord); };
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    /* ---------------------------------------------------------------- session bar, pointer */

    function el(tag, cls, html) {
        var e = document.createElement(tag);
        e.className = cls;
        if (html) {
            e.innerHTML = html;
        }
        return e;
    }

    function showBar() {
        if (ui.bar) {
            return;
        }
        injectStyles();
        ui.bar = el('div', 'fs-cb-ui fs-cb-bar', '<span class="fs-cb-bar__dot"></span><span></span><button type="button"></button>');
        ui.bar.children[1].textContent = T.live;
        ui.bar.children[2].textContent = T.end;
        ui.bar.querySelector('button').addEventListener('click', function () { end(true); });
        document.body.appendChild(ui.bar);
    }

    function pointer(on, x, y) {
        if (!ui.pointer) {
            injectStyles();
            ui.pointer = el('div', 'fs-cb-ui fs-cb-pointer');
            document.body.appendChild(ui.pointer);
        }
        ui.pointer.style.display = on ? 'block' : 'none';
        ui.pointer.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    }

    function click(x, y) {
        injectStyles();
        var r = el('div', 'fs-cb-ui fs-cb-click');
        r.style.left = x + 'px';
        r.style.top = y + 'px';
        document.body.appendChild(r);
        setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 900);
    }

    function clearUi() {
        ['bar', 'pointer'].forEach(function (k) {
            if (ui[k] && ui[k].parentNode) {
                ui[k].parentNode.removeChild(ui[k]);
            }
            ui[k] = null;
        });
    }

    /* ---------------------------------------------------------------- consent */

    function askConsent() {
        var own = CONSENT ? document.querySelector(CONSENT) : null;
        return new Promise(function (resolve) {
            var modal = own;
            if (!modal) {
                injectStyles();
                modal = el('div', 'fs-cb-ui fs-cb-modal', '<div class="fs-cb-modal__box" role="dialog" aria-modal="true">'
                    + '<button type="button" class="fs-cb-modal__close cobrowse-consent__close">&times;</button>'
                    + '<p class="fs-cb-modal__title"></p><p class="fs-cb-text"></p><p class="fs-cb-note"></p>'
                    + '<div class="fs-cb-modal__actions"><button type="button" class="fs-cb-deny cobrowse-consent__deny"></button>'
                    + '<button type="button" class="fs-cb-allow cobrowse-consent__allow"></button></div></div>');
                modal.querySelector('.fs-cb-modal__close').setAttribute('aria-label', T.close);
                modal.querySelector('.fs-cb-modal__title').textContent = T.title;
                modal.querySelector('.fs-cb-text').textContent = T.text;
                modal.querySelector('.fs-cb-note').textContent = T.note;
                modal.querySelector('.fs-cb-deny').textContent = T.deny;
                modal.querySelector('.fs-cb-allow').textContent = T.allow;
                document.body.appendChild(modal);
            }
            var done = function (ok) {
                modal.removeEventListener('click', onClick);
                if (own) {
                    own.classList.remove('is-open');
                } else if (modal.parentNode) {
                    modal.parentNode.removeChild(modal);
                }
                resolve(ok);
            };
            var onClick = function (e) {
                if (e.target.closest('.cobrowse-consent__allow')) {
                    done(true);
                } else if (e.target.closest('.cobrowse-consent__deny, .cobrowse-consent__close, .cobrowse-consent__background')
                    || e.target === modal) {
                    done(false);
                }
            };
            modal.addEventListener('click', onClick);
            if (own) {
                own.classList.add('is-open');
            }
        });
    }

    /* ---------------------------------------------------------------- device information */

    // What the browser says about itself, for the agent's "Device" panel. Sent only once the customer has accepted.
    function deviceInfo() {
        var n = navigator;
        var s = window.screen || {};
        var vv = window.visualViewport;
        var i = {
            ua: String(n.userAgent || '').slice(0, 400),
            platform: String(n.platform || '').slice(0, 40),
            lang: String(n.language || '').slice(0, 20),
            touch: n.maxTouchPoints || 0,
            vw: window.innerWidth || 0,
            vh: window.innerHeight || 0,
            sw: s.width || 0,
            sh: s.height || 0,
            dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
            zoom: vv && vv.scale ? Math.round(vv.scale * 100) / 100 : 1,
            orient: (s.orientation && s.orientation.type)
                || ((window.innerWidth || 0) > (window.innerHeight || 0) ? 'landscape' : 'portrait'),
            tz: ''
        };
        try { i.tz = String(Intl.DateTimeFormat().resolvedOptions().timeZone || '').slice(0, 60); } catch (e) { /* old browser */ }
        var d = n.userAgentData;
        if (d) {
            i.uad = {
                brands: (d.brands || []).slice(0, 6).map(function (b) { return String(b.brand).slice(0, 40) + ' ' + String(b.version).slice(0, 20); }),
                platform: String(d.platform || '').slice(0, 40),
                mobile: !!d.mobile
            };
            if (hints) {
                i.uad.platformVersion = String(hints.platformVersion || '').slice(0, 20);
                i.uad.model = String(hints.model || '').slice(0, 60);
                i.uad.full = (hints.fullVersionList || []).slice(0, 6).map(function (b) { return String(b.brand).slice(0, 40) + ' ' + String(b.version).slice(0, 30); });
            }
        }
        return i;
    }

    var hints = null; // Chromium only: real system version, device model and full browser version
    var infoTimer = null;

    function sendInfo() {
        if (state && state.consent) {
            send({t: 'info', i: deviceInfo()});
        }
    }

    function sendInfoSoon() {
        clearTimeout(infoTimer);
        infoTimer = setTimeout(sendInfo, 400);
    }

    function startInfo() {
        sendInfo();
        var d = navigator.userAgentData;
        if (!hints && d && d.getHighEntropyValues) {
            d.getHighEntropyValues(['platformVersion', 'model', 'fullVersionList']).then(function (h) {
                hints = h || {};
                sendInfo();
            }, function () { /* refused: the low-entropy values are enough */ });
        }
    }

    // window resized, tablet rotated, page zoomed
    window.addEventListener('resize', sendInfoSoon);
    window.addEventListener('orientationchange', sendInfoSoon);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', sendInfoSoon);
    }

    /* ---------------------------------------------------------------- recording */

    function startRecording() {
        if (stopRecord) {
            return;
        }
        showBar();
        startInfo();
        loadRecorder().then(function (rr) {
            if (!state || !state.consent || stopRecord) {
                return;
            }
            stopRecord = rr.record({
                emit: function (event) {
                    if (ws && ws.readyState === 1) {
                        ws.send(JSON.stringify({t: 'ev', e: event}));
                    }
                },
                maskAllInputs: MASK_ALL,
                maskInputOptions: {password: true},
                // the session bar, the pointer and the consent dialog are not shown to the agent
                blockSelector: '.fs-cb-ui' + (CONSENT ? ', ' + CONSENT : ''),
                sampling: {mousemove: 50, scroll: 100, input: 'last'},
                recordCanvas: false,
                collectFonts: false
            }) || function () {};
        });
    }

    function stopRecording() {
        if (stopRecord) {
            try { stopRecord(); } catch (e) { /* already stopped */ }
        }
        stopRecord = null;
    }

    function codeTarget() {
        return document.querySelector(CODE);
    }

    function end(byCustomer) {
        if (byCustomer) {
            send({t: 'end'});
        }
        stopRecording();
        clearUi();
        state = null;
        save();
        if (ws) {
            try { ws.close(); } catch (e) { /* already closed */ }
        }
        ws = null;
        var target = codeTarget();
        if (target) {
            target.textContent = '';
        }
    }

    function connect(resume) {
        var url = RELAY + '?role=client' + (resume ? '&resume=' + encodeURIComponent(resume.code)
            + '&key=' + encodeURIComponent(resume.key) : '');
        return new Promise(function (resolve) {
            ws = new WebSocket(url);
            ws.onmessage = function (m) {
                var msg;
                try { msg = JSON.parse(m.data); } catch (e) { return; }
                switch (msg.t) {
                    case 'code':
                        state = {code: msg.code, key: msg.key, consent: false};
                        save();
                        resolve(msg.code);
                        break;
                    case 'resumed':
                        state.consent = !!msg.consent;
                        save();
                        if (state.consent) {
                            startRecording();
                        }
                        resolve(msg.code);
                        break;
                    case 'agent':
                        askConsent().then(function (ok) {
                            if (!state) {
                                return;
                            }
                            state.consent = ok;
                            save();
                            send({t: 'consent', ok: ok});
                            if (ok) {
                                startRecording();
                            } else {
                                end(false);
                            }
                        });
                        break;
                    case 'snapshot':
                        if (window.rrwebRecord && stopRecord) {
                            window.rrwebRecord.record.takeFullSnapshot(true);
                        }
                        break;
                    case 'pointer':
                        pointer(msg.on, msg.x, msg.y);
                        break;
                    case 'click':
                        click(msg.x, msg.y);
                        break;
                    case 'agentleft':
                        pointer(false, 0, 0);
                        break;
                    case 'end':
                    case 'error':
                        end(false);
                        resolve(null);
                        break;
                }
            };
            ws.onerror = function () { resolve(null); };
        });
    }

    // "Get an assistance code": the code stays on screen for 30 s
    document.addEventListener('click', function (e) {
        var trigger = e.target.closest && e.target.closest(TRIGGER);
        if (!trigger) {
            return;
        }
        e.preventDefault();
        var show = function (code) {
            var target = codeTarget();
            if (target && code) {
                target.textContent = code;
                setTimeout(function () { if (target.textContent === code) target.textContent = ''; }, 30000);
            }
        };
        if (state && ws && ws.readyState === 1) {
            show(state.code);
            return;
        }
        connect(null).then(show);
    });

    // session started on the previous page: resume it
    var previous = load();
    if (previous && previous.code && previous.key) {
        state = previous;
        connect(previous);
    }
})();
