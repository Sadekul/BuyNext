<?php

/*
 * BuyNest settings. Change them with environment variables, not by editing
 * this file.
 */
return [
    // Emailed one-time codes (sign-up verification, password reset).
    'codes' => [
        'length' => 6,
        'ttl_minutes' => (int) env('BUYNEST_CODE_TTL_MINUTES', 10),
        'max_attempts' => 5,          // wrong guesses before the code stops working
        'resend_cooldown_seconds' => 60,
    ],

    // Sign-in tokens (Sanctum). The storefront's sign-in service keeps them in
    // HttpOnly cookies; the browser never sees them.
    'tokens' => [
        'access_minutes' => 60,
        'refresh_minutes' => 24 * 60,            // without "Keep me signed in"
        'refresh_remember_minutes' => 7 * 24 * 60, // with "Keep me signed in"
    ],

    // Sign-in, sign-up, and code requests allowed per visitor per minute.
    'auth_per_minute' => (int) env('BUYNEST_AUTH_PER_MINUTE', 30),
    // ...and per email address per minute, for each of those routes.
    'auth_per_email_per_minute' => (int) env('BUYNEST_AUTH_PER_EMAIL_PER_MINUTE', 10),

    // Unverified sign-ups are deleted after this many days.
    'prune_unverified_after_days' => 7,

    // The sign-in service (BFF) calls this API from the server, so every
    // request comes from the same address. With this shared key it may pass
    // on the visitor's real IP address, which rate limits then use.
    'bff_key' => env('BFF_SHARED_KEY'),

    // Local test inbox at /dev/mailbox (only when APP_ENV=local).
    'dev_mailbox' => (bool) env('DEV_MAILBOX', false),

    // Orders placed per visitor per minute (checkout clicks, guest or signed in).
    'orders_per_minute' => (int) env('BUYNEST_ORDERS_PER_MINUTE', 10),

    /*
     * Store rules that are code, not settings: the ids and wording of the
     * shipping and payment methods. Everything shop staff can change (prices,
     * the free-shipping threshold, which methods are on, countries, tax, guest
     * checkout, the low-stock threshold) lives in the database since phase 4:
     * App\Services\Settings (admin: Stores → Settings), with the old values
     * as defaults.
     */
    'store' => [
        'currency' => 'USD',

        // Keys are the ids the storefront sends. Prices come from the settings
        // (standard_price, express_price, next_day_price). Standard is the
        // only one that becomes free over the threshold.
        'shipping_methods' => [
            'standard' => ['label' => 'Standard', 'eta' => '3–5 business days', 'price_setting' => 'standard_price', 'free_over_threshold' => true],
            'express' => ['label' => 'Express', 'eta' => '1–2 business days', 'price_setting' => 'express_price', 'free_over_threshold' => false],
            'nextDay' => ['label' => 'Next day', 'eta' => 'Next business day (order by 2 pm)', 'price_setting' => 'next_day_price', 'free_over_threshold' => false],
        ],

        'payment_methods' => [
            'card' => 'Credit or debit card',
            'paypal' => 'PayPal',
            'cod' => 'Cash on delivery',
        ],
    ],
];
