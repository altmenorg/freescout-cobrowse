<form class="form-horizontal margin-top margin-bottom" method="POST" action="" autocomplete="off">
    {{ csrf_field() }}

    <div class="form-group">
        <div class="col-sm-6 col-sm-offset-2">
            <p class="text-help">
                {{ __('Lets agents co-browse with customers on your website or app through Cobrowse.io, from the conversation sidebar.') }}
                <a href="https://github.com/altmenorg/freescout-cobrowse#readme" target="_blank" rel="noopener">{{ __('Setup guide') }}</a>
            </p>
        </div>
    </div>

    <div class="form-group">
        <label class="col-sm-2 control-label">{{ __('License key') }}</label>
        <div class="col-sm-6">
            <input type="text" name="settings[cobrowse.license]" value="{{ $settings['cobrowse.license'] }}" class="form-control input-sized-lg" />
            <p class="form-help">
                {{ __('Your Cobrowse.io license key (Cobrowse.io › Settings).') }}
                @if (!$settings['cobrowse.license'] && $env_license) {{ __('Currently set in the .env file (COBROWSE_LICENSE).') }} @endif
            </p>
        </div>
    </div>

    <div class="form-group">
        <label class="col-sm-2 control-label">{{ __('Private key') }}</label>
        <div class="col-sm-6">
            <textarea name="settings[cobrowse.private_key]" rows="4" class="form-control input-sized-lg" placeholder="-----BEGIN PRIVATE KEY-----">{{ $settings['cobrowse.private_key'] }}</textarea>
            <p class="form-help">
                {{ __('Optional. RS256 private key (PEM) from Cobrowse.io › Settings › Integrations › JWT. Signs agents in to Cobrowse automatically. Stored encrypted.') }}
                @if (!$settings['cobrowse.private_key'] && $env_key) {{ __('Currently set in the .env file (COBROWSE_PRIVATE_KEY).') }} @endif
            </p>
        </div>
    </div>

    <div class="form-group">
        <label class="col-sm-2 control-label">{{ __('Agent screen') }}</label>
        <div class="col-sm-6">
            <select name="settings[cobrowse.embed]" class="form-control input-sized-lg">
                <option value="code" @if ($settings['cobrowse.embed'] == 'code') selected @endif>{{ __('6-digit code (the customer reads a code to the agent)') }}</option>
                <option value="dashboard" @if ($settings['cobrowse.embed'] == 'dashboard') selected @endif>{{ __('Device list (all connected devices)') }}</option>
                <option value="connect" @if ($settings['cobrowse.embed'] == 'connect') selected @endif>{{ __('Device list filtered on the customer\'s e-mail') }}</option>
            </select>
            <p class="form-help">{{ __('The filtered list requires your website to send the user\'s e-mail to Cobrowse.io (customData.user_email).') }}</p>
        </div>
    </div>

    <div class="form-group">
        <label class="col-sm-2 control-label">{{ __('Help text') }}</label>
        <div class="col-sm-6">
            <input type="text" name="settings[cobrowse.help_text]" value="{{ $settings['cobrowse.help_text'] }}" class="form-control input-sized-lg" />
            <p class="form-help">{{ __('Optional. Replaces the default hint shown to agents above the "Open Cobrowse" button.') }}</p>
        </div>
    </div>

    <div class="form-group margin-top">
        <div class="col-sm-6 col-sm-offset-2">
            <button type="submit" class="btn btn-primary">{{ __('Save') }}</button>
        </div>
    </div>
</form>
