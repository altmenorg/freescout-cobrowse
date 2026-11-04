/**
 * Self-hosted agent screen (Resources/views/agent.blade.php).
 *
 * 1. The agent types the customer's 6-digit code; the page opens the relay WebSocket with the agent token.
 * 2. The relay asks the customer to accept; on acceptance the customer's page arrives as rrweb events and is replayed
 *    live here (rrweb Replayer, live mode), scaled to fit the frame.
 * 3. "Pointer": the agent's mouse over the replay is sent to the customer as a pointer, a click as a ripple. Coordinates
 *    are in the customer's viewport (the replay shows the customer's viewport, scrolled as on the customer's side).
 *    Nothing is clicked on the customer's page.
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
    var pointerBtn = $('cb-pointer');

    var ws = null;
    var replayer = null;
    var started = false;
    var view = {width: 0, height: 0, scale: 1, actual: false};
    var sizeBtn = $('cb-size');
    var pointerOn = false;
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
    var submit = document.querySelector('#cb-code-form button[type=submit]');
    var code = function () { return digits.map(function (d) { return d.value; }).join(''); };
    var refresh = function () { submit.disabled = !/^\d{6}$/.test(code()); };

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
        if (!submit.disabled) {
            connect(code());
        }
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
        // fit the frame, or the customer's real size (100 %, the stage scrolls)
        var scale = view.actual ? 1 : Math.min(w / view.width, h / view.height, 1);
        view.scale = scale;
        stage.classList.toggle('is-actual', view.actual);
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
            insertStyleRules: ['.me-cb-ui, .cobrowse-consent { display: none !important; }']
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
    sizeBtn.addEventListener('click', function () {
        view.actual = !view.actual;
        sizeBtn.classList.toggle('is-on', view.actual);
        sizeBtn.setAttribute('aria-pressed', view.actual ? 'true' : 'false');
        fit();
    });

    /* ------------------------------------------------------------------ pointer */

    function position(e) {
        var r = overlay.getBoundingClientRect();
        return {x: Math.round((e.clientX - r.left) / view.scale), y: Math.round((e.clientY - r.top) / view.scale)};
    }

    function setPointer(on) {
        pointerOn = on;
        pointerBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        pointerBtn.classList.toggle('is-on', on);
        overlay.classList.toggle('is-on', on);
        if (!on) {
            send({t: 'pointer', on: false, x: 0, y: 0});
        }
    }

    pointerBtn.addEventListener('click', function () { setPointer(!pointerOn); });
    overlay.addEventListener('mousemove', function (e) {
        if (!pointerOn) {
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
    overlay.addEventListener('mouseleave', function () {
        if (pointerOn) {
            send({t: 'pointer', on: false, x: 0, y: 0});
        }
    });
    overlay.addEventListener('click', function (e) {
        if (!pointerOn) {
            return;
        }
        var p = position(e);
        send({t: 'click', x: p.x, y: p.y});
    });

    $('cb-end').addEventListener('click', function () {
        send({t: 'end'});
        ended = true;
        status(L('ended'), true);
        teardown();
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
        Array.prototype.slice.call(stage.querySelectorAll('.replayer-wrapper')).forEach(function (n) { n.remove(); });
        setPointerSilently(false);
    }

    function setPointerSilently(on) {
        pointerOn = on;
        pointerBtn.setAttribute('aria-pressed', 'false');
        pointerBtn.classList.remove('is-on');
        overlay.classList.remove('is-on');
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
