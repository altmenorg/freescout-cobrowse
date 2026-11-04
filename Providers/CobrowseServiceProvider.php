<?php

namespace Modules\Cobrowse\Providers;

use Illuminate\Support\ServiceProvider;

define('COBROWSE_MODULE', 'cobrowse');

/**
 * Cobrowse.io integration for FreeScout.
 *
 * - Conversation sidebar: a "Co-browsing" block that opens the Cobrowse.io agent screen (6-digit code by default)
 *   in a floating, resizable frame, without leaving the ticket.
 * - Full-page Cobrowse.io dashboard at /cobrowse (link in the top menu).
 * - Agents are signed in to Cobrowse.io automatically with an RS256 JWT built here from the account's private key
 *   (docs.cobrowse.io > Agent-side integrations > JWTs). Without a key, Cobrowse.io asks agents to log in.
 *
 * Settings: Manage > Settings > Cobrowse (stored as FreeScout options, private key encrypted). The COBROWSE_* .env
 * variables are still read as a fallback (COBROWSE_PRIVATE_KEY = path to a PEM file).
 * The iframe is only loaded when the agent clicks "Open": no call to Cobrowse.io when a ticket is merely viewed.
 *
 * Self-hosted mode (provider `selfhosted`, from 1.2.0): no Cobrowse.io account. The website records the customer's page
 * with rrweb and sends it to your own WebSocket relay; the agent screen (/cobrowse/agent, Public/js/agent.js) replays it
 * live and can show a pointer and clicks to the customer (view only, no remote control). Agents are authenticated on the
 * relay by a short-lived token signed here with the shared secret (HMAC-SHA256). Relay and website script: see README.
 */
class CobrowseServiceProvider extends ServiceProvider
{
    protected $defer = false;

    const EMBEDS = ['code', 'dashboard', 'connect'];
    const PROVIDERS = ['cobrowseio', 'selfhosted'];

    public function boot()
    {
        $this->registerConfig();
        $this->registerViews();
        $this->loadJsonTranslationsFrom(__DIR__.'/../Resources/lang');
        $this->registerRoutes();
        $this->registerAssets();
        $this->registerSettings();
        $this->hooks();
    }

    /* ------------------------------------------------------------------ settings */

    /** Setting value: FreeScout option first, then config / .env fallback. */
    public static function setting($key)
    {
        $value = \Option::get('cobrowse.'.$key, null);
        if ($value === null || $value === '') {
            $value = config('cobrowse.'.$key);
        }
        return $value;
    }

    public static function provider()
    {
        $provider = self::setting('provider');
        return in_array($provider, self::PROVIDERS) ? $provider : 'cobrowseio';
    }

    public static function selfHosted()
    {
        return self::provider() === 'selfhosted';
    }

    public static function isConfigured()
    {
        if (self::selfHosted()) {
            return self::setting('relay_url') && self::relaySecret() !== '';
        }
        return (bool)self::setting('license');
    }

    /** Shared secret of the self-hosted relay: encrypted option, or COBROWSE_RELAY_SECRET in .env. */
    public static function relaySecret()
    {
        $stored = \Option::get('cobrowse.relay_secret', '');
        if ($stored) {
            try {
                $secret = trim((string)decrypt($stored));
                if ($secret !== '') {
                    return $secret;
                }
            } catch (\Exception $e) {
                \Log::error('[Cobrowse] cannot decrypt the stored relay secret');
            }
        }
        return trim((string)config('cobrowse.relay_secret'));
    }

    /** Agent token for the self-hosted relay: base64url(JSON {n, exp}) . base64url(HMAC-SHA256), valid 8 hours. */
    public static function relayToken($user)
    {
        $secret = self::relaySecret();
        if (!$secret || !$user) {
            return '';
        }
        $b64 = function ($data) {
            return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
        };
        $payload = $b64(json_encode(['n' => $user->getFullName(), 'exp' => time() + 8 * 3600]));
        return $payload.'.'.$b64(hash_hmac('sha256', $payload, $secret, true));
    }

    /** PEM private key: encrypted option, or (legacy) path to a PEM file in COBROWSE_PRIVATE_KEY. */
    public static function privateKey()
    {
        $stored = \Option::get('cobrowse.private_key', '');
        if ($stored) {
            try {
                $pem = trim((string)decrypt($stored));
            } catch (\Exception $e) {
                \Log::error('[Cobrowse] cannot decrypt the stored private key');
                $pem = '';
            }
            // saving the settings page with an empty field stores an encrypted empty string: fall back to .env then
            if ($pem !== '') {
                return $pem;
            }
        }
        $path = config('cobrowse.private_key');
        if ($path && is_readable($path)) {
            return (string)file_get_contents($path);
        }
        return '';
    }

    /** A non-empty private key is stored in the options (and not just an encrypted empty string). */
    protected static function storedKeyIsSet()
    {
        $stored = \Option::get('cobrowse.private_key', '');
        if (!$stored) {
            return false;
        }
        try {
            return trim((string)decrypt($stored)) !== '';
        } catch (\Exception $e) {
            return false;
        }
    }

    protected function registerSettings()
    {
        \Eventy::addFilter('settings.sections', function ($sections) {
            $sections[COBROWSE_MODULE] = ['title' => 'Cobrowse', 'icon' => 'screenshot', 'order' => 650];
            return $sections;
        }, 40);

        \Eventy::addFilter('settings.section_settings', function ($settings, $section) {
            if ($section != COBROWSE_MODULE) {
                return $settings;
            }
            $settings['cobrowse.license'] = \Option::get('cobrowse.license', '');
            $settings['cobrowse.private_key'] = self::storedKeyIsSet() ? '********' : '';
            $settings['cobrowse.embed'] = \Option::get('cobrowse.embed', '') ?: 'code';
            $settings['cobrowse.help_text'] = \Option::get('cobrowse.help_text', '');
            $settings['cobrowse.provider'] = \Option::get('cobrowse.provider', '') ?: (config('cobrowse.provider') ?: 'cobrowseio');
            $settings['cobrowse.relay_url'] = \Option::get('cobrowse.relay_url', '');
            $settings['cobrowse.relay_secret'] = \Option::get('cobrowse.relay_secret', '') ? '********' : '';
            return $settings;
        }, 20, 2);

        \Eventy::addFilter('settings.section_params', function ($params, $section) {
            if ($section != COBROWSE_MODULE) {
                return $params;
            }
            return [
                'template_vars' => [
                    'env_license' => (bool)config('cobrowse.license'),
                    'env_key'     => (bool)config('cobrowse.private_key'),
                    'env_relay'   => (bool)config('cobrowse.relay_url'),
                ],
                'settings' => [
                    // private key: masked in the form, not overwritten when left as asterisks, stored encrypted
                    'cobrowse.private_key' => ['safe_password' => true, 'encrypt' => true],
                    'cobrowse.relay_secret' => ['safe_password' => true, 'encrypt' => true],
                ],
            ];
        }, 20, 2);

        \Eventy::addFilter('settings.view', function ($view, $section) {
            return $section == COBROWSE_MODULE ? 'cobrowse::settings' : $view;
        }, 20, 2);
    }

    /* ------------------------------------------------------------------ routes, assets */

    /** /cobrowse: Cobrowse.io dashboard as a full page. */
    protected function registerRoutes()
    {
        \Route::group(['middleware' => ['web', 'auth']], function () {
            \Route::get('/cobrowse', function () {
                if (!self::isConfigured()) {
                    abort(404);
                }
                if (self::selfHosted()) {
                    return view('cobrowse::dashboard', ['url' => route('cobrowse.agent'), 'has_token' => true]);
                }
                $token = self::makeJwt(auth()->user());
                return view('cobrowse::dashboard', ['url' => self::embedUrl('dashboard', $token, null, true), 'has_token' => (bool)$token]);
            })->name('cobrowse.dashboard');

            // Self-hosted agent screen (loaded in the floating frame or the full page)
            \Route::get('/cobrowse/agent', function () {
                // available as soon as the relay is set, so it can be tried before switching the provider
                if (!self::setting('relay_url') || self::relaySecret() === '') {
                    abort(404);
                }
                return response()->view('cobrowse::agent', [
                    'relay_url' => (string)self::setting('relay_url'),
                    'token'     => self::relayToken(auth()->user()),
                ]);
            })->name('cobrowse.agent');
        });
    }

    protected function registerAssets()
    {
        // Files, not inline code: FreeScout's Content-Security-Policy blocks inline scripts.
        \Eventy::addFilter('stylesheets', function ($styles) {
            $styles[] = \Module::getPublicPath(COBROWSE_MODULE).'/css/module.css';
            return $styles;
        });
        \Eventy::addFilter('javascripts', function ($javascripts) {
            $javascripts[] = \Module::getPublicPath(COBROWSE_MODULE).'/js/module.js';
            return $javascripts;
        });
    }

    /**
     * Cobrowse.io embed URL. $full = whole page (Cobrowse navigation visible); otherwise the compact ticket panel.
     */
    public static function embedUrl($embed, $token, $conversation = null, $full = false)
    {
        $params = $full ? [] : ['navigation' => 'none', 'end_action' => ($embed === 'code' ? 'code' : 'dashboard'), 'popout' => 'none'];
        if ($token) {
            $params['token'] = $token;
        }
        // "connect" mode: pre-filter devices on the customer's e-mail (the website SDK must set customData.user_email)
        if ($embed === 'connect' && $conversation && $conversation->customer_email) {
            $params['filter_user_email'] = $conversation->customer_email;
        }
        return 'https://cobrowse.io/'.$embed.($params ? '?'.http_build_query($params) : '');
    }

    public function hooks()
    {
        // Left icon bar of the Refresh interface (https://github.com/altmenorg/freescout-refresh): the entry comes with its
        // own icon. No effect without Refresh.
        \Eventy::addFilter('refresh.rail_items', function ($items) {
            if (!self::isConfigured()) {
                return $items;
            }
            $items[] = [
                'url'    => route('cobrowse.dashboard'),
                'label'  => 'Cobrowse',
                'icon'   => asset(\Module::getPublicPath(COBROWSE_MODULE).'/icons/cobrowse.svg'),
                'active' => \Route::is('cobrowse.dashboard'),
                'order'  => 500,
            ];
            return $items;
        });

        // Top menu link to the full-page dashboard
        \Eventy::addAction('menu.append', function () {
            if (!self::isConfigured()) {
                return;
            }
            echo '<li class="'.(\Route::is('cobrowse.dashboard') ? 'active' : '').'"><a href="'.e(route('cobrowse.dashboard')).'">Cobrowse</a></li>';
        });

        // Conversation sidebar block
        \Eventy::addAction('conversation.after_customer_sidebar', function ($conversation) {
            if (!self::isConfigured()) {
                return; // installed but not configured: nothing to show
            }
            $embed = self::setting('embed');
            if (!in_array($embed, self::EMBEDS) || self::selfHosted()) {
                $embed = 'code';
            }
            // self-hosted: no Cobrowse.io sign-in, the agent screen is ours
            $token = self::selfHosted() ? 'relay' : self::makeJwt(auth()->user());
            echo \View::make('cobrowse::sidebar', [
                'url'          => self::selfHosted() ? route('cobrowse.agent') : self::embedUrl($embed, $token, $conversation),
                'has_token'    => (bool)$token,
                'help_text'    => (string)self::setting('help_text'),
                'embed'        => $embed,
                'conversation' => $conversation,
            ])->render();
        });
    }

    /**
     * RS256 JWT signed with the account's private key (openssl_sign, no dependency).
     * Claims required by Cobrowse.io: iat, exp, aud, iss (license key), sub (agent e-mail), displayName.
     */
    public static function makeJwt($user)
    {
        $license = self::setting('license');
        $pem = self::privateKey();
        if (!$license || !$pem || !$user) {
            return '';
        }
        $key = openssl_pkey_get_private($pem);
        if (!$key) {
            \Log::error('[Cobrowse] invalid private key');
            return '';
        }
        $b64 = function ($data) {
            return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
        };
        $now = time();
        $header = $b64(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
        $payload = $b64(json_encode([
            'iat'         => $now,
            'exp'         => $now + 8 * 3600, // one working day; Cobrowse.io recommends less than 24 h
            'aud'         => 'https://cobrowse.io',
            'iss'         => $license,
            'sub'         => $user->email,
            'displayName' => $user->getFullName(),
            'role'        => 'agent',
        ]));
        $signature = '';
        openssl_sign($header.'.'.$payload, $signature, $key, OPENSSL_ALGO_SHA256);
        return $header.'.'.$payload.'.'.$b64($signature);
    }

    public function register()
    {
    }

    protected function registerConfig()
    {
        $this->mergeConfigFrom(__DIR__.'/../Config/config.php', 'cobrowse');
    }

    public function registerViews()
    {
        $viewPath = resource_path('views/modules/cobrowse');
        $sourcePath = __DIR__.'/../Resources/views';
        $this->publishes([$sourcePath => $viewPath], 'views');
        $this->loadViewsFrom(array_merge(array_map(function ($path) {
            return $path.'/modules/cobrowse';
        }, \Config::get('view.paths')), [$sourcePath]), 'cobrowse');
    }

    public function provides()
    {
        return [];
    }
}
