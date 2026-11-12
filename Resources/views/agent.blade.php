{{-- Self-hosted agent screen (provider "selfhosted"): 6-digit code, then the customer's page replayed live (rrweb), with
     a pointer the customer sees. Standalone page, loaded in the floating frame of the sidebar block or in /cobrowse.
     Behaviour: Public/js/agent.js (a file: FreeScout's CSP blocks inline scripts). --}}
@php
    // file date as version: a new version of the module is never served from the browser cache
    $asset = function ($file) {
        $path = \Module::find('Cobrowse')->getPath().'/Public'.$file;
        return asset(\Module::getPublicPath(COBROWSE_MODULE).$file).'?v='.(is_file($path) ? filemtime($path) : '0');
    };
@endphp
<!DOCTYPE html>
<html lang="{{ app()->getLocale() }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Cobrowse</title>
    <link rel="stylesheet" href="{{ $asset('/vendor/rrweb-2.2.0/replay.css') }}">
    <link rel="stylesheet" href="{{ $asset('/css/agent.css') }}">
</head>
<body>
<div id="cb-agent" data-relay="{{ $relay_url }}" data-token="{{ $token }}"
     data-l-waiting="{{ __('Waiting for the customer to accept…') }}"
     data-l-refused="{{ __('The customer declined the session.') }}"
     data-l-ended="{{ __('Session ended.') }}"
     data-l-badcode="{{ __('Unknown or expired code. Ask the customer for a new one.') }}"
     data-l-badtoken="{{ __('Your session has expired: reload the page.') }}"
     data-l-away="{{ __('The customer is loading another page…') }}"
     data-l-offline="{{ __('Connection lost.') }}"
     data-l-browser="{{ __('Browser') }}"
     data-l-system="{{ __('System') }}"
     data-l-device="{{ __('Device') }}"
     data-l-window="{{ __('Window') }}"
     data-l-screen="{{ __('Screen') }}"
     data-l-zoom="{{ __('Zoom') }}"
     data-l-touch="{{ __('Touch screen') }}"
     data-l-orientation="{{ __('Orientation') }}"
     data-l-language="{{ __('Language') }}"
     data-l-timezone="{{ __('Time zone') }}"
     data-l-useragent="{{ __('User agent') }}"
     data-l-desktop="{{ __('Computer') }}"
     data-l-tablet="{{ __('Tablet') }}"
     data-l-phone="{{ __('Phone') }}"
     data-l-desktopsite="{{ __('desktop site requested') }}"
     data-l-inapp="{{ __('inside the :app app') }}"
     data-l-yes="{{ __('Yes') }}"
     data-l-no="{{ __('No') }}"
     data-l-points="{{ __('touch points') }}"
     data-l-portrait="{{ __('Portrait') }}"
     data-l-landscape="{{ __('Landscape') }}"
     data-l-density="{{ __('pixel ratio') }}"
     data-l-webkit="{{ __('On iPhone and iPad every browser runs on the engine of Safari (WebKit), whatever its name.') }}"
     data-l-copied="{{ __('Copied') }}">

    <section class="cb-screen cb-code" id="cb-code">
        <h1>{{ __('Enter the 6-digit code') }}</h1>
        <p>{{ __('The customer gets it from the "Get an assistance code" link on the website.') }}</p>
        <form id="cb-code-form" autocomplete="off">
            <div class="cb-digits">
                @for ($i = 0; $i < 6; $i++)
                    <input type="text" inputmode="numeric" autocomplete="one-time-code" aria-label="{{ __('Digit') }} {{ $i + 1 }}">
                @endfor
            </div>
            <p class="cb-error" id="cb-error" hidden></p>
        </form>
    </section>

    <section class="cb-screen cb-status" id="cb-status" hidden>
        <div class="cb-spinner"></div>
        <p id="cb-status-text"></p>
        <button type="button" class="cb-btn cb-back" hidden>{{ __('New code') }}</button>
    </section>

    <section class="cb-screen cb-session" id="cb-session" hidden>
        <div class="cb-toolbar">
            <span class="cb-live"><span class="cb-live-dot"></span>{{ __('Live') }}</span>
            <span class="cb-toolbar-tools">
                <button type="button" class="cb-tool cb-info-toggle" aria-expanded="false" aria-controls="cb-info">
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 20h8M12 16v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    <span>{{ __('Device') }}</span>
                </button>
                <button type="button" class="cb-tool" id="cb-fs">
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    <span>{{ __('Full screen') }}</span>
                </button>
                <button type="button" class="cb-btn cb-btn-danger cb-end">{{ __('End session') }}</button>
            </span>
        </div>
        <div class="cb-stage" id="cb-stage">
            {{-- the agent's mouse is shown to the customer as a pointer while the left button is held down, a click as a ripple --}}
            <div class="cb-overlay" id="cb-overlay"></div>
            <div class="cb-away" id="cb-away" hidden></div>
        </div>
        {{-- what the customer's browser says about itself (website script, once the session is accepted) --}}
        <aside class="cb-info" id="cb-info" hidden>
            <div class="cb-info-head">
                <strong>{{ __('Device of the customer') }}</strong>
                <button type="button" class="cb-info-close" aria-label="{{ __('Close') }}">&times;</button>
            </div>
            <p class="cb-info-empty" id="cb-info-empty">{{ __('The website has not sent this information: its cobrowse.js is older than version 1.3.') }}</p>
            <dl id="cb-info-list"></dl>
            <p class="cb-info-note" id="cb-info-note" hidden></p>
            <button type="button" class="cb-btn" id="cb-info-copy" hidden>{{ __('Copy') }}</button>
        </aside>
        {{-- full screen only: back to the window, end the session --}}
        <div class="cb-fsbar">
            <button type="button" class="cb-btn cb-info-toggle" aria-expanded="false" aria-controls="cb-info">{{ __('Device') }}</button>
            <button type="button" class="cb-btn" id="cb-fs-exit">{{ __('Exit full screen') }}</button>
            <button type="button" class="cb-btn cb-btn-danger cb-end">{{ __('End session') }}</button>
        </div>
    </section>
</div>
<script src="{{ $asset('/vendor/rrweb-2.2.0/replay.js') }}"></script>
<script src="{{ $asset('/js/device.js') }}"></script>
<script src="{{ $asset('/js/agent.js') }}"></script>
</body>
</html>
