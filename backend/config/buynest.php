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

    // Production: refuse every /api request that doesn't carry the shared key (see RequireBffKey).
    'require_bff_key' => (bool) env('BUYNEST_REQUIRE_BFF_KEY', false),

    // Phase 7: the storefront's address, for links in emails (newsletter
    // confirm/unsubscribe, cart reminders) and the sitemap.
    'storefront_url' => rtrim((string) env('STOREFRONT_URL', 'http://localhost:5173'), '/'),

    /*
     * Phase 8: card payments through Stripe Checkout (Stripe's hosted payment
     * page). Stripe is on only when the secret key is set; without it card
     * orders wait for an admin to invoice them, as before. Never logged.
     */
    'stripe' => [
        'secret_key' => env('STRIPE_SECRET_KEY') ?: null,
        'webhook_secret' => env('STRIPE_WEBHOOK_SECRET') ?: null,
        'currency' => strtolower((string) (env('STRIPE_CURRENCY') ?: 'usd')),
        // How long a storefront payment page stays open. Stripe allows 30 minutes to 24 hours.
        'checkout_minutes' => min(1440, max(30, (int) (env('STRIPE_CHECKOUT_MINUTES') ?: 30))),
        // Payment links staff send for orders created in the admin stay open for Stripe's maximum (24 hours).
        'admin_link_minutes' => 1440,
        // Only changed for local browser checks against a stand-in server (e2e/payments.mjs).
        'api_url' => env('STRIPE_API_URL', 'https://api.stripe.com/v1'),
        'timeout_seconds' => 15,
        // A webhook whose signed timestamp is older (or newer) than this is refused (replay protection).
        'webhook_tolerance_seconds' => 300,
        'webhooks_per_minute' => (int) env('BUYNEST_STRIPE_WEBHOOKS_PER_MINUTE', 300),
    ],

    // Phase 7: newsletter sign-ups per visitor per minute, and per email per hour.
    'newsletter_per_minute' => (int) env('BUYNEST_NEWSLETTER_PER_MINUTE', 10),
    'newsletter_per_email_per_hour' => (int) env('BUYNEST_NEWSLETTER_PER_EMAIL_PER_HOUR', 3),

    // Local test inbox at /dev/mailbox (only when APP_ENV=local).
    'dev_mailbox' => (bool) env('DEV_MAILBOX', false),

    // Orders placed per visitor per minute (checkout clicks, guest or signed in).
    'orders_per_minute' => (int) env('BUYNEST_ORDERS_PER_MINUTE', 10),

    // API requests per signed-in account (or per visitor) per minute.
    'api_per_minute' => (int) env('BUYNEST_API_PER_MINUTE', 240),

    // Product reviews a customer may post per hour (spam guard).
    'reviews_per_hour' => (int) env('BUYNEST_REVIEWS_PER_HOUR', 10),

    // Phase 9 (part B): browser error reports and "email me when it's back in stock".
    'client_errors_per_minute' => (int) env('BUYNEST_CLIENT_ERRORS_PER_MINUTE', 10),
    'stock_alerts_per_minute' => (int) env('BUYNEST_STOCK_ALERTS_PER_MINUTE', 10),
    'stock_alerts_per_email_per_hour' => (int) env('BUYNEST_STOCK_ALERTS_PER_EMAIL_PER_HOUR', 5),

    /*
     * Phase 9 (part B): database backups (php artisan buynest:backup).
     * The file goes to the "backups" disk (config/filesystems.php):
     * BACKUP_DISK=local (BACKUP_LOCAL_PATH) or s3 (any S3-compatible bucket).
     * The database password is never put on a command line: mysqldump reads
     * it from a temporary file only this process can read, deleted afterwards.
     */
    'backups' => [
        'disk' => env('BACKUP_DISK', 'local') === 's3' ? 's3' : 'local',
        'keep_days' => max(1, (int) env('BACKUP_KEEP_DAYS', 14)),
        'dump_binary' => env('BACKUP_DUMP_BINARY', 'mysqldump'),
        'timeout_seconds' => (int) env('BACKUP_TIMEOUT_SECONDS', 900),
        // Daily at this time in BACKUP_TIMEZONE (the store's time zone: the app's, UTC, unless set).
        'schedule' => (bool) env('BACKUP_SCHEDULE', true),
        'time' => env('BACKUP_TIME', '03:00'),
        'timezone' => env('BACKUP_TIMEZONE') ?: env('APP_TIMEZONE', 'UTC'),
    ],

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

        // Phase 6: only staff may choose these, for orders they create in the admin.
        // Bank transfer waits for the money (pending payment, like card); cash is
        // handled like cash on delivery (processing, may ship before the invoice).
        'admin_payment_methods' => [
            'bank_transfer' => 'Bank transfer',
            'cash' => 'Cash',
        ],
    ],
];
