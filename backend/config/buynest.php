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
     * Store rules. Every amount is in whole CENTS (499 = $4.99), because
     * integers add up exactly and floats don't. App\Services\Pricing is the
     * only code that reads these money rules. They move into the admin in
     * phase 4.
     */
    'store' => [
        'currency' => 'USD',
        'tax_cents' => 0, // tax rules arrive in phase 4

        // Free standard shipping once the merchandise (after the coupon) reaches this.
        'free_shipping_threshold_cents' => 5000,

        // Keys are the ids the storefront sends. Standard is the only one that can be free.
        'shipping_methods' => [
            'standard' => ['label' => 'Standard', 'eta' => '3–5 business days', 'price_cents' => 499, 'free_over_threshold' => true],
            'express' => ['label' => 'Express', 'eta' => '1–2 business days', 'price_cents' => 1299, 'free_over_threshold' => false],
            'nextDay' => ['label' => 'Next day', 'eta' => 'Next business day (order by 2 pm)', 'price_cents' => 2499, 'free_over_threshold' => false],
        ],

        // Coupons live in the database since phase 3 (coupons table, admin: Marketing → Coupons).

        'payment_methods' => [
            'card' => 'Credit or debit card',
            'paypal' => 'PayPal',
            'cod' => 'Cash on delivery',
        ],

        'countries' => ['United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'Bangladesh', 'India'],

        // Fewer units than this shows as "low stock".
        'low_stock_threshold' => 10,
    ],
];
