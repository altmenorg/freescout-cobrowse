<?php

// Fallback values when nothing is set in Manage > Settings > Cobrowse.
return [
    'name'        => 'Cobrowse',
    // Cobrowse.io license key (JWT `iss` claim).
    'license'     => env('COBROWSE_LICENSE', ''),
    // PATH to the RS256 private key (PEM) from Cobrowse.io > Settings > Integrations > JWT.
    'private_key' => env('COBROWSE_PRIVATE_KEY', ''),
    // code (6-digit code, default) | dashboard (all devices) | connect (devices filtered on the customer e-mail)
    'embed'       => env('COBROWSE_EMBED', 'code'),
    'help_text'   => env('COBROWSE_HELP_TEXT', ''),
];
