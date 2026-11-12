/**
 * Reads what the customer's browser says about itself (the `info` message of website/cobrowse.js) for the "Device"
 * panel of the agent screen: browser and version, system and version, kind of device.
 *
 * Pure function, no DOM: `cobrowseDevice(info)` returns
 *   {browser, version, inApp, os, osVersion, type: 'desktop'|'tablet'|'phone', model, webkit, desktopSite}
 *
 * What a user agent hides, and how it is worked around:
 * - an iPad that asks for the desktop site says it is a Mac: a "Macintosh" with several touch points is an iPad;
 * - on iOS and iPadOS every browser runs on Safari's engine (WebKit), whatever its name: `webkit` is true;
 * - Safari 26 and later freeze the system version at 18.7 in the user agent: Safari's own version (the same number as
 *   the system since 26) is used instead;
 * - Chrome freezes "Android 10; K" and "Windows NT 10.0": the real version comes from the client hints
 *   (`uad.platformVersion`) when the browser gives them; Windows 11 reports a platform version of 13 or more;
 * - macOS is frozen at 10.15.7 in every browser: no version is shown unless the client hints give one.
 */
(function (root) {
    'use strict';

    // first match wins: the most specific tokens first ("Chrome" and "Safari" appear in almost every user agent)
    var BROWSERS = [
        ['EdgiOS', 'Edge'], ['CriOS', 'Chrome'], ['FxiOS', 'Firefox'], ['OPiOS', 'Opera'], ['GSA', 'Google app'],
        ['EdgA', 'Edge'], ['Edg', 'Edge'], ['OPR', 'Opera'], ['SamsungBrowser', 'Samsung Internet'],
        ['YaBrowser', 'Yandex Browser'], ['Vivaldi', 'Vivaldi'], ['Firefox', 'Firefox'], ['Chrome', 'Chrome']
    ];
    var BRANDS = {'Google Chrome': 'Chrome', 'Microsoft Edge': 'Edge'};

    function short(version, parts) {
        return String(version || '').split('.').slice(0, parts).join('.');
    }

    function cobrowseDevice(info) {
        info = info || {};
        var ua = String(info.ua || '');
        var d = info.uad && typeof info.uad === 'object' ? info.uad : null;
        var touch = +info.touch || 0;
        var out = {browser: '', version: '', inApp: '', os: '', osVersion: '', type: 'desktop', model: '', webkit: false, desktopSite: false};
        var m;

        /* browser */
        for (var b = 0; b < BROWSERS.length && !out.browser; b++) {
            m = new RegExp('\\b' + BROWSERS[b][0] + '/([\\d.]+)').exec(ua);
            if (m) {
                out.browser = BROWSERS[b][1];
                out.version = m[1];
            }
        }
        var safari = /\bVersion\/([\d.]+)/.exec(ua);
        if (!out.browser && safari && /Safari\//.test(ua)) {
            out.browser = 'Safari';
            out.version = safari[1];
        }
        if (/\bFBA[NV]\//.test(ua)) {
            out.inApp = 'Facebook';
        } else if (/\bInstagram\b/.test(ua)) {
            out.inApp = 'Instagram';
        }
        // Chromium: the user agent only gives the major version ("157.0.0.0"), the client hints the full one
        var full = d && Array.isArray(d.full) ? d.full : [];
        var chromium = '';
        for (var f = 0; f < full.length; f++) {
            m = /^(.*) ([\d.]+)$/.exec(String(full[f]));
            if (!m || /not.?a.?brand/i.test(m[1])) {
                continue;
            }
            if (m[1] === 'Chromium') {
                chromium = m[2];
            } else if (/^(Chrome|Edge|Opera|)$/.test(out.browser)) {
                out.browser = BRANDS[m[1]] || m[1];
                out.version = m[2];
                chromium = '';
                break;
            }
        }
        if (chromium && (out.browser === 'Chrome' || !out.browser)) {
            out.browser = out.browser || 'Chromium';
            out.version = chromium;
        }

        /* system and kind of device */
        var ios = /\b(iPad|iPhone|iPod)\b/.exec(ua);
        var hinted = d && d.platformVersion ? String(d.platformVersion) : '';
        if (ios) {
            out.os = ios[1] === 'iPad' ? 'iPadOS' : 'iOS';
            out.type = ios[1] === 'iPad' ? 'tablet' : 'phone';
            out.webkit = true;
            m = /\bOS (\d+)[_.](\d+)(?:[_.](\d+))?/.exec(ua);
            if (m) {
                out.osVersion = m[1] + '.' + m[2] + (m[3] ? '.' + m[3] : '');
                if (+m[1] === 18 && safari && parseInt(safari[1], 10) >= 26) {
                    out.osVersion = short(safari[1], 2);
                }
            }
        } else if (/Macintosh/.test(ua) && touch > 1) {
            out.os = 'iPadOS';
            out.type = 'tablet';
            out.webkit = true;
            out.desktopSite = true;
            out.osVersion = safari ? short(safari[1], 2) : '';
        } else if (/Android/.test(ua)) {
            out.os = 'Android';
            out.type = /Mobile/.test(ua) || (d && d.mobile) ? 'phone' : 'tablet';
            m = /Android (\d+(?:\.\d+)*)/.exec(ua);
            var frozen = /Android 10; K\)/.test(ua);
            out.osVersion = hinted ? short(hinted, 2).replace(/\.0$/, '') : (m && !frozen ? m[1] : '');
            m = /Android [^;)]+; ([^;)]+?)(?: Build\/[^;)]*)?\)/.exec(ua);
            out.model = d && d.model ? String(d.model) : (m && m[1] !== 'K' && !/^(wv|Mobile|Tablet)$/.test(m[1]) ? m[1] : '');
        } else if ((m = /Windows NT (\d+\.\d+)/.exec(ua))) {
            out.os = 'Windows';
            var nt = {'10.0': '10 / 11', '6.3': '8.1', '6.2': '8', '6.1': '7'};
            out.osVersion = nt[m[1]] || '';
            if (m[1] === '10.0' && hinted) {
                out.osVersion = parseInt(hinted, 10) >= 13 ? '11' : '10';
            }
        } else if (/\bCrOS\b/.test(ua)) {
            out.os = 'ChromeOS';
        } else if ((m = /Mac OS X (\d+)[_.](\d+)(?:[_.](\d+))?/.exec(ua))) {
            out.os = 'macOS';
            var mac = m[1] + '.' + m[2] + (m[3] ? '.' + m[3] : '');
            out.osVersion = hinted ? short(hinted, 2) : (mac === '10.15.7' ? '' : mac);
        } else if (/Linux|X11/.test(ua)) {
            out.os = 'Linux';
        } else if (d && d.platform) {
            out.os = String(d.platform);
        }
        return out;
    }

    root.cobrowseDevice = cobrowseDevice;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = cobrowseDevice;
    }
})(typeof window !== 'undefined' ? window : this);
