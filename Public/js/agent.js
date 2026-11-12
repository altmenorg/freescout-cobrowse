/**
 * Self-hosted agent screen (Resources/views/agent.blade.php).
 *
 * 1. The agent types the customer's 6-digit code; the page opens the relay WebSocket with the agent token.
 * 2. The relay asks the customer to accept; on acceptance the customer's page arrives as rrweb events and is replayed
 *    live here (rrweb Replayer, live mode), scaled to fit the frame.
 * 3. The agent's mouse is shown to the customer as a pointer while the left button is held down, a click as a ripple.
 *    Coordinates are in the customer's viewport (the replay shows the customer's viewport, scrolled as on the customer's
 *    side). Nothing is clicked on the customer's page.
 * 4. "Full screen": the session fills the screen (Fullscreen API), with "Exit full screen" and "End session" at the
 *    bottom.
 * 5. "Device": a panel with the customer's browser, system, window and screen size (the `info` message of the website
 *    script, read by Public/js/device.js). Everything in it comes from the customer's browser: it is written as text,
 *    never as HTML.
 */
(function () {
    'use strict';
    var root = document.getElementById('cb-agent');
    if (!root || !window.rrwebReplay) {
        return;
    }
    var L = function (k) { return root.getAttribute('data-l-' + k) || ''; };
    var RELAY = root.getAttribute('data-relay');
    var TOKEN = root.getAttribute('data-token');

    var $ = function (id) { return document.getElementById(id); };
    var screens = {code: $('cb-code'), status: $('cb-status'), session: $('cb-session')};
    var stage = $('cb-stage');
    var overlay = $('cb-overlay');

    var ws = null;
    var replayer = null;
    var started = false;
    var view = {width: 0, height: 0, scale: 1};
    var lastSent = 0;
    var ended = false;

    function show(name) {
        Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
    }

    function status(text, canRetry) {
        $('cb-status-text').textContent = text;
        screens.status.querySelector('.cb-spinner').hidden = !!canRetry;
        screens.status.querySelector('.cb-back').hidden = !canRetry;
        show('status');
    }

    function send(msg) {
        if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify(msg));
        }
    }

    /* ------------------------------------------------------------------ code entry (6 boxes) */

    var digits = Array.prototype.slice.call(document.querySelectorAll('.cb-digits input'));
    var code = function () { return digits.map(function (d) { return d.value; }).join(''); };
    var tried = '';
    // no button: the session opens as soon as the six digits are there (once per code)
    var refresh = function () {
        var c = code();
        if (/^\d{6}$/.test(c) && c !== tried) {
            tried = c;
            connect(c);
        } else if (c.length < 6) {
            tried = '';
        }
    };

    digits.forEach(function (input, i) {
        input.addEventListener('input', function () {
            // several digits at once (typed fast, autofill): spread them over the next boxes
            var typed = input.value.replace(/\D/g, '');
            var j = i;
            input.value = '';
            for (var k = 0; k < typed.length && j < digits.length; k++, j++) {
                digits[j].value = typed[k];
            }
            if (typed && digits[Math.min(j, digits.length - 1)]) {
                digits[Math.min(j, digits.length - 1)].focus();
            }
            refresh();
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Backspace' && !input.value && digits[i - 1]) {
                digits[i - 1].focus();
            }
        });
        input.addEventListener('paste', function (e) {
            var text = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, '').slice(0, 6);
            if (!text) {
                return;
            }
            e.preventDefault();
            digits.forEach(function (d, j) { d.value = text[j] || ''; });
            (digits[Math.min(text.length, 5)]).focus();
            refresh();
        });
    });
    digits[0].focus();

    $('cb-code-form').addEventListener('submit', function (e) {
        e.preventDefault();
        tried = '';
        refresh();
    });

    screens.status.querySelector('.cb-back').addEventListener('click', reset);

    function reset() {
        teardown();
        ended = false;
        digits.forEach(function (d) { d.value = ''; });
        refresh();
        $('cb-error').hidden = true;
        show('code');
        digits[0].focus();
    }

    function error(text) {
        teardown();
        show('code');
        $('cb-error').textContent = text;
        $('cb-error').hidden = false;
    }

    /* ------------------------------------------------------------------ replay */

    function fit() {
        if (!replayer || !view.width) {
            return;
        }
        var wrapper = stage.querySelector('.replayer-wrapper');
        if (!wrapper) {
            return;
        }
        var w = stage.clientWidth;
        var h = stage.clientHeight;
        var scale = Math.min(w / view.width, h / view.height, 1);
        view.scale = scale;
        var left = Math.max(0, (w - view.width * scale) / 2);
        var top = Math.max(0, (h - view.height * scale) / 2);
        wrapper.style.transformOrigin = '0 0';
        wrapper.style.transform = 'translate(' + left + 'px,' + top + 'px) scale(' + scale + ')';
        overlay.style.left = left + 'px';
        overlay.style.top = top + 'px';
        overlay.style.width = view.width * scale + 'px';
        overlay.style.height = view.height * scale + 'px';
    }

    function startReplay() {
        if (replayer) {
            return;
        }
        replayer = new window.rrwebReplay.Replayer([], {
            root: stage,
            liveMode: true,
            mouseTail: false,
            showWarning: false,
            triggerFocus: false,
            // the customer's own session bar and consent dialog (website script) are not part of the page
            insertStyleRules: ['.me-cb-ui, .fs-cb-ui, .cobrowse-consent { display: none !important; }']
        });
        replayer.on('resize', function (d) {
            view.width = d.width;
            view.height = d.height;
            fit();
        });
    }

    function onEvent(ev) {
        startReplay();
        if (!started) {
            // the customer's clock: play each event as soon as it arrives
            replayer.startLive(ev.timestamp - 300);
            started = true;
        }
        replayer.addEvent(ev);
        $('cb-away').hidden = true;
    }

    window.addEventListener('resize', fit);

    /* ------------------------------------------------------------------ full screen */

    function exitFullscreen() {
        if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen();
        }
    }

    $('cb-fs').addEventListener('click', function () {
        if (screens.session.requestFullscreen) {
            screens.session.requestFullscreen();
        }
    });
    $('cb-fs-exit').addEventListener('click', exitFullscreen);
    document.addEventListener('fullscreenchange', function () {
        screens.session.classList.toggle('is-fs', document.fullscreenElement === screens.session);
        setTimeout(fit, 50);
    });

    /* ------------------------------------------------------------------ customer's device */

    var info = null;
    var infoPanel = $('cb-info');
    var infoToggles = Array.prototype.slice.call(document.querySelectorAll('.cb-info-toggle'));

    function infoRows() {
        if (!info || !window.cobrowseDevice) {
            return [];
        }
        var d = window.cobrowseDevice(info);
        var num = function (v) { return isFinite(+v) ? +v : 0; };
        var join = function (parts, sep) { return parts.filter(Boolean).join(sep); };
        var orient = /landscape/.test(String(info.orient)) ? L('landscape') : (/portrait/.test(String(info.orient)) ? L('portrait') : '');
        var device = join([L(d.type), d.model], ' · ') + (d.desktopSite ? ' (' + L('desktopsite') + ')' : '');
        var dpr = num(info.dpr);
        return [
            [L('browser'), join([join([d.browser, d.version], ' '), d.inApp ? L('inapp').replace(':app', d.inApp) : ''], ', ')],
            [L('system'), join([d.os, d.osVersion], ' ')],
            [L('device'), device],
            // a tab in the background reports a window of 0 × 0
            [L('window'), num(info.vw) && num(info.vh) ? num(info.vw) + ' × ' + num(info.vh) : ''],
            [L('screen'), num(info.sw) && num(info.sh) ? num(info.sw) + ' × ' + num(info.sh) + (dpr && dpr !== 1 ? ' (' + L('density') + ' ' + dpr + ')' : '') : ''],
            [L('zoom'), Math.round((num(info.zoom) || 1) * 100) + ' %'],
            [L('touch'), num(info.touch) > 0 ? L('yes') + ' (' + num(info.touch) + ' ' + L('points') + ')' : L('no')],
            [L('orientation'), orient],
            [L('language'), String(info.lang || '')],
            [L('timezone'), String(info.tz || '')],
            [L('useragent'), String(info.ua || '')]
        ].filter(function (row) { return row[1]; });
    }

    function renderInfo() {
        var rows = infoRows();
        var list = $('cb-info-list');
        list.textContent = '';
        rows.forEach(function (row) {
            var dt = document.createElement('dt');
            var dd = document.createElement('dd');
            dt.textContent = row[0];
            dd.textContent = row[1];
            list.appendChild(dt);
            list.appendChild(dd);
        });
        var webkit = !!(info && window.cobrowseDevice && window.cobrowseDevice(info).webkit);
        $('cb-info-note').textContent = webkit ? L('webkit') : '';
        $('cb-info-note').hidden = !webkit;
        $('cb-info-empty').hidden = rows.length > 0;
        $('cb-info-copy').hidden = rows.length === 0;
    }

    function toggleInfo(open) {
        infoPanel.hidden = !open;
        infoToggles.forEach(function (btn) {
            btn.classList.toggle('is-on', open);
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    }

    infoToggles.forEach(function (btn) {
        btn.addEventListener('click', function () { toggleInfo(infoPanel.hidden); });
    });
    infoPanel.querySelector('.cb-info-close').addEventListener('click', function () { toggleInfo(false); });

    // copies the panel as text ("Browser: Chrome 141…"), to paste into the ticket
    $('cb-info-copy').addEventListener('click', function () {
        var btn = this;
        var label = btn.textContent;
        var text = infoRows().map(function (row) { return row[0] + ': ' + row[1]; }).join('\n');
        var done = function () {
            btn.textContent = L('copied');
            setTimeout(function () { btn.textContent = label; }, 1500);
        };
        var fallback = function () {
            var area = document.createElement('textarea');
            area.value = text;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            infoPanel.appendChild(area);
            area.select();
            try { document.execCommand('copy'); done(); } catch (e) { /* clipboard refused */ }
            infoPanel.removeChild(area);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, fallback);
        } else {
            fallback();
        }
    });

    /* ------------------------------------------------------------------ pointer */

    function position(e) {
        var r = overlay.getBoundingClientRect();
        return {x: Math.round((e.clientX - r.left) / view.scale), y: Math.round((e.clientY - r.top) / view.scale)};
    }

    // like Cobrowse.io: the customer sees the pointer only while the agent holds the left button down; a click also
    // draws a ripple
    var down = false;

    function release() {
        if (down) {
            down = false;
            send({t: 'pointer', on: false, x: 0, y: 0});
        }
    }

    overlay.addEventListener('mousedown', function (e) {
        if (e.button !== 0) {
            return;
        }
        e.preventDefault();
        down = true;
        var p = position(e);
        lastSent = Date.now();
        send({t: 'pointer', on: true, x: p.x, y: p.y});
    });
    overlay.addEventListener('mousemove', function (e) {
        if (!down) {
            return;
        }
        var now = Date.now();
        if (now - lastSent < 50) {
            return;
        }
        lastSent = now;
        var p = position(e);
        send({t: 'pointer', on: true, x: p.x, y: p.y});
    });
    window.addEventListener('mouseup', release);
    overlay.addEventListener('mouseleave', release);
    window.addEventListener('blur', release);
    overlay.addEventListener('click', function (e) {
        var p = position(e);
        send({t: 'click', x: p.x, y: p.y});
    });

    Array.prototype.slice.call(document.querySelectorAll('.cb-end')).forEach(function (btn) {
        btn.addEventListener('click', function () {
            exitFullscreen();
            send({t: 'end'});
            ended = true;
            status(L('ended'), true);
            teardown();
        });
    });

    /* ------------------------------------------------------------------ relay */

    function teardown() {
        if (ws) {
            ws.onclose = null;
            try { ws.close(); } catch (e) { /* closed */ }
        }
        ws = null;
        if (replayer) {
            try { replayer.destroy(); } catch (e) { /* gone */ }
        }
        replayer = null;
        started = false;
        info = null;
        renderInfo();
        toggleInfo(false);
        Array.prototype.slice.call(stage.querySelectorAll('.replayer-wrapper')).forEach(function (n) { n.remove(); });
    }

    function connect(c) {
        teardown();
        ended = false;
        status(L('waiting'), false);
        ws = new WebSocket(RELAY + '?role=agent&code=' + encodeURIComponent(c) + '&token=' + encodeURIComponent(TOKEN));
        ws.onmessage = function (m) {
            var data = m.data;
            if (data.indexOf('{"t":"ev"') === 0) {
                try { onEvent(JSON.parse(data).e); } catch (e) { /* malformed event */ }
                return;
            }
            var msg;
            try { msg = JSON.parse(data); } catch (e) { return; }
            switch (msg.t) {
                case 'waiting':
                    status(L('waiting'), false);
                    break;
                case 'consent':
                    if (msg.ok) {
                        show('session');
                        fit();
                    } else {
                        ended = true;
                        status(L('refused'), true);
                    }
                    break;
                case 'info':
                    info = msg.i && typeof msg.i === 'object' ? msg.i : null;
                    renderInfo();
                    break;
                case 'clientaway':
                    $('cb-away').textContent = L('away');
                    $('cb-away').hidden = false;
                    break;
                case 'clientback':
                    $('cb-away').hidden = true;
                    break;
                case 'error':
                    error(msg.error === 'token' ? L('badtoken') : L('badcode'));
                    break;
                case 'end':
                    if (!ended) {
                        exitFullscreen();
                        ended = true;
                        status(msg.reason === 'refused' ? L('refused') : L('ended'), true);
                        teardown();
                    }
                    break;
            }
        };
        ws.onclose = function () {
            if (!ended && screens.code.hidden) {
                ended = true;
                status(L('offline'), true);
            }
        };
    }

    show('code');
})();
