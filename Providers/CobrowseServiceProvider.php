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
 */
class CobrowseServiceProvider extends ServiceProvider
{
    protected $defer = false;

    const EMBEDS = ['code', 'dashboard', 'connect'];

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

    public static function isConfigured()
    {
        return (bool)self::setting('license');
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
                ],
                'settings' => [
                    // private key: masked in the form, not overwritten when left as asterisks, stored encrypted
                    'cobrowse.private_key' => ['safe_password' => true, 'encrypt' => true],
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
                $token = self::makeJwt(auth()->user());
                return view('cobrowse::dashboard', ['url' => self::embedUrl('dashboard', $token, null, true), 'has_token' => (bool)$token]);
            })->name('cobrowse.dashboard');
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
            if (!in_array($embed, self::EMBEDS)) {
                $embed = 'code';
            }
            $token = self::makeJwt(auth()->user());
            echo \View::make('cobrowse::sidebar', [
                'url'          => self::embedUrl($embed, $token, $conversation),
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
