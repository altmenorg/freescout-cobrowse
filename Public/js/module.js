/**
 * Cobrowse.io integration for FreeScout — sidebar block behaviour (loaded as a file: FreeScout's CSP blocks inline scripts).
 * Delegated handlers: they work whatever the render order of the sidebar.
 */
(function ($) {
    if (!$) {
        return;
    }

    // The frame is moved to <body> on first open: inside the sidebar it stays under the header
    // (stacking context of the layout) and its toolbar gets hidden once maximized.
    var frameWrap = function () {
        var wrap = $('body > .cobrowse-frame');
        if (!wrap.length) {
            wrap = $('.cobrowse-block .cobrowse-frame').first().appendTo('body');
        }
        return wrap;
    };

    var store = {
        get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
        set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
    };

    // Maximize: the frame fills the window (16 px margin); remembered for next time
    var setMax = function (wrap, on) {
        wrap.toggleClass('cobrowse-max', on);
        wrap.find('.cobrowse-max-btn')
            .attr('title', on ? wrap.attr('data-label-min') : wrap.attr('data-label-max'))
            .find('.glyphicon').toggleClass('glyphicon-resize-full', !on).toggleClass('glyphicon-resize-small', on);
        store.set('cobrowse_max', on ? '1' : '0');
    };

    $(document).on('click', '.cobrowse-open', function () {
        var btn = $(this);
        var wrap = frameWrap();
        var frame = wrap.find('iframe');
        if (frame.attr('src') === 'about:blank') {
            frame.attr('src', btn.attr('data-src'));
        }
        setMax(wrap, store.get('cobrowse_max') === '1');
        wrap.addClass('cobrowse-shown');
        btn.text(btn.attr('data-label-opened')).prop('disabled', true);
    });

    $(document).on('click', '.cobrowse-close', function () {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        }
        $(this).closest('.cobrowse-frame').removeClass('cobrowse-shown');
        var btn = $('.cobrowse-open');
        btn.text(btn.attr('data-label-open')).prop('disabled', false);
    });

    $(document).on('click', '.cobrowse-max-btn', function () {
        var wrap = $(this).closest('.cobrowse-frame');
        setMax(wrap, !wrap.hasClass('cobrowse-max'));
    });

    // Full screen: the whole screen, through the browser Fullscreen API (Esc to leave)
    $(document).on('click', '.cobrowse-fs-btn', function () {
        var el = $(this).closest('.cobrowse-frame').get(0);
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else if (el.requestFullscreen) {
            el.requestFullscreen();
        }
    });
})(window.jQuery);
