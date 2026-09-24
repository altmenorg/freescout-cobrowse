{{-- Co-browsing block in the conversation sidebar. The iframe is only loaded on click (no Cobrowse.io request
     until the agent asks for it). Behaviour: Public/js/module.js; styles: Public/css/module.css. --}}
<div class="conv-sidebar-block cobrowse-block">
    <div class="panel-group accordion accordion-empty">
        <div class="panel panel-default">
            <div class="panel-heading">
                <h4 class="panel-title">
                    <a data-toggle="collapse" href="#cobrowse-panel" class="collapsed">{{ __('Co-browsing') }}
                        <b class="caret"></b>
                    </a>
                </h4>
            </div>
            <div id="cobrowse-panel" class="panel-collapse collapse">
                <div class="panel-body">
                    <p class="text-help cobrowse-help">
                        @if ($help_text)
                            {{ $help_text }}
                        @elseif ($embed === 'code')
                            {{ __('Ask the customer for the 6-digit code shown on your website, then enter it in Cobrowse.') }}
                        @else
                            {{ __('Pick the customer\'s device in Cobrowse to start the session.') }}
                        @endif
                    </p>
                    @if (!$has_token)
                        <p class="text-warning cobrowse-warn">{{ __('Automatic sign-in is off (no private key): Cobrowse will ask you to log in.') }}</p>
                    @endif
                    <button type="button" class="btn btn-primary btn-sm cobrowse-open" data-src="{{ $url }}" data-label-open="{{ __('Open Cobrowse') }}" data-label-opened="{{ __('Cobrowse open') }}">{{ __('Open Cobrowse') }}</button>
                    <a href="{{ $url }}" target="_blank" rel="noopener" class="btn btn-default btn-sm" title="{{ __('Open in a new tab') }}"><i class="glyphicon glyphicon-new-window"></i></a>
                    {{-- Floating frame, bottom right (the sidebar is too narrow for the Cobrowse screen).
                         Moved to <body> on first open by module.js so it is never clipped by the layout. --}}
                    <div class="cobrowse-frame" data-label-max="{{ __('Maximize') }}" data-label-min="{{ __('Restore') }}">
                        <div class="cobrowse-frame-bar">
                            <span>Cobrowse</span>
                            <span class="cobrowse-tools">
                                <button type="button" class="btn btn-default btn-xs cobrowse-max-btn" title="{{ __('Maximize') }}"><i class="glyphicon glyphicon-resize-full"></i></button>
                                <button type="button" class="btn btn-default btn-xs cobrowse-fs-btn" title="{{ __('Full screen') }}"><i class="glyphicon glyphicon-fullscreen"></i></button>
                                <button type="button" class="btn btn-default btn-xs cobrowse-close" title="{{ __('Close') }}">&times;</button>
                            </span>
                        </div>
                        <iframe src="about:blank" allow="clipboard-read; clipboard-write; fullscreen" allowfullscreen></iframe>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
