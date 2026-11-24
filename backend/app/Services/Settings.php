<?php

namespace App\Services;

use App\Support\Currency;
use App\Support\Locale;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Store settings (Magento's Stores → Configuration): one `settings` row per
 * key, the value as JSON. Read through the cache, because checkout, cart
 * pricing, and every product page need them; saving clears the cache.
 *
 * A key with no row uses its DEFAULT (the values phase 2/3 had in
 * config/buynest.php), so the shop works even before anyone saves a setting.
 * Money is a "0.00" string, like everywhere else in the API.
 *
 * Besides the settings groups, the table also keeps the home page content
 * (key "home_content", see HomeContent), so it shares the same cache.
 */
class Settings
{
    private const CACHE_KEY = 'buynest.settings';

    /** The groups the admin shows (GET/PATCH /api/admin/v1/settings) and their keys. */
    public const GROUPS = [
        // Phase 13: default_locale (en|bn: the language a first visit gets) and bangla_digits (০–৯ in Bangla).
        'general' => ['store_name', 'support_email', 'support_phone', 'address', 'default_locale', 'bangla_digits'],
        // Phase 10 (part B): default_weight_grams (products without a weight, for table rates).
        'shipping' => ['standard_price', 'free_shipping_threshold', 'express_price', 'next_day_price', 'enabled_methods', 'default_weight_grams'],
        'tax' => ['tax_enabled', 'tax_rates', 'prices_include_tax'],
        // Phase 14: default_country (null = none; a Bangladeshi store sets Bangladesh).
        'checkout' => ['allowed_countries', 'guest_checkout', 'enabled_payment_methods', 'default_country'],
        'inventory' => ['low_stock_threshold'],
        // Phase 5: Settings → Catalog. The contract calls it reviews.require_approval.
        'catalog' => ['reviews_require_approval'],
        // Phase 6: Settings → Returns (RMA).
        'returns' => ['returns_enabled', 'return_window_days', 'return_reasons'],
        // Phase 9 (part A): Settings → Security (changing it needs the Owner role, see SettingsController).
        'security' => ['require_admin_two_factor'],
        // Phase 10 (part A): Settings → Documents (PDF invoices and credit memos) and Settings → Analytics.
        'documents' => ['paper_size', 'attach_pdf_to_emails'],
        'analytics' => ['ga4_measurement_id'],
        // Phase 11: Settings → Reward points. The API names (enabled, ...) are stored as rewards_enabled, ... (STORAGE_KEYS).
        'rewards' => ['enabled', 'earn_rate', 'point_value', 'min_redeem', 'max_percent', 'signup_bonus', 'review_bonus'],
        // Phase 14: Settings → Payment methods → Cash on delivery. Stored as cod_max_order_total, ... (STORAGE_KEYS).
        'cod' => ['max_order_total', 'fee', 'advance', 'zones', 'require_confirmation'],
    ];

    /** Phase 11: group key → stored key, for groups whose API names would clash with other keys. */
    public const STORAGE_KEYS = [
        'rewards' => [
            'enabled' => 'rewards_enabled',
            'earn_rate' => 'rewards_earn_rate',
            'point_value' => 'rewards_point_value',
            'min_redeem' => 'rewards_min_redeem',
            'max_percent' => 'rewards_max_percent',
            'signup_bonus' => 'rewards_signup_bonus',
            'review_bonus' => 'rewards_review_bonus',
        ],
        'cod' => [
            'max_order_total' => 'cod_max_order_total',
            'fee' => 'cod_fee',
            'advance' => 'cod_advance',
            'zones' => 'cod_zones',
            'require_confirmation' => 'cod_require_confirmation',
        ],
    ];

    /** Phase 11: the stored key of a group's key ("rewards", "enabled" → "rewards_enabled"). */
    public static function storageKey(string $group, string $key): string
    {
        return self::STORAGE_KEYS[$group][$key] ?? $key;
    }

    public const DEFAULTS = [
        'store_name' => 'BuyNest',
        'support_email' => 'support@buynest.example.com',
        'support_phone' => '+1 (555) 010-2030',
        'address' => null,
        'default_locale' => 'en', // phase 13
        'bangla_digits' => true, // phase 13
        'standard_price' => '4.99',
        'free_shipping_threshold' => '50.00',
        'express_price' => '12.99',
        'next_day_price' => '24.99',
        'default_weight_grams' => 500, // phase 10 (part B)
        'enabled_methods' => ['standard', 'express', 'nextDay'],
        'tax_enabled' => false,
        'tax_rates' => [], // [{ country: "Germany", rate: "19.00" }] (percent)
        'prices_include_tax' => false,
        'allowed_countries' => ['United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'Bangladesh', 'India'],
        'guest_checkout' => true,
        'enabled_payment_methods' => ['card', 'paypal', 'cod'],
        'low_stock_threshold' => 10,
        'reviews_require_approval' => true, // false: new reviews are public at once
        'returns_enabled' => true,
        'return_window_days' => 30, // from the delivered date, or the last shipment without one
        'return_reasons' => ['Damaged', 'Wrong item', 'Not as described', 'No longer needed', 'Other'],
        // Phase 9 (part A): every admin must use two-step sign-in.
        'require_admin_two_factor' => false,
        // Phase 10 (part A): PDF paper size (a4|letter), the invoice email's PDF, and Google Analytics 4 (null = off).
        'paper_size' => 'a4',
        'attach_pdf_to_emails' => true,
        'ga4_measurement_id' => null,
        // Phase 11: reward points (off by default). earn_rate: points per 1.00 of eligible spend; point_value: money per point;
        // max_percent: the share of the grand total points may pay.
        'rewards_enabled' => false,
        'rewards_earn_rate' => '1.00',
        'rewards_point_value' => '0.0100',
        'rewards_min_redeem' => 100,
        'rewards_max_percent' => 50,
        'rewards_signup_bonus' => 0,
        'rewards_review_bonus' => 0,
        // Phase 14: the country address forms start with (null: none), and cash on delivery (the defaults change nothing).
        'default_country' => null,
        'cod_max_order_total' => null, // null = no limit
        'cod_fee' => '0.00',
        'cod_advance' => 'none', // none | delivery_charge (paid online through SSLCommerz first)
        'cod_zones' => [], // delivery zone codes; [] = everywhere
        'cod_require_confirmation' => false,
    ];

    private const MONEY_KEYS = ['standard_price', 'free_shipping_threshold', 'express_price', 'next_day_price', 'cod_fee'];

    /** Values for this request, so the cache is read once (null = not loaded yet). */
    private ?array $values = null;

    /** Every stored value (with defaults for the missing ones), key => value. */
    public function all(): array
    {
        return $this->values ??= [
            ...self::DEFAULTS,
            ...Cache::rememberForever(self::CACHE_KEY, fn () => DB::table('settings')->pluck('value', 'key')
                ->map(fn ($json) => json_decode($json, true))->all()),
        ];
    }

    public function get(string $key, mixed $default = null): mixed
    {
        return array_key_exists($key, $this->all()) ? $this->all()[$key] : $default;
    }

    /** A money setting in cents ("4.99" → 499). */
    public function cents(string $key): int
    {
        return Pricing::toCents((string) $this->get($key, '0'));
    }

    /** The settings groups, as GET /api/admin/v1/settings answers them. */
    public function grouped(): array
    {
        $grouped = [];
        foreach (self::GROUPS as $group => $keys) {
            $grouped[$group] = array_combine($keys, array_map(fn ($key) => $this->get(self::storageKey($group, $key)), $keys));
        }

        return $grouped;
    }

    /** Saves key => value pairs (already validated and normalized) and clears the cache. */
    public function put(array $values): void
    {
        $now = now();
        foreach ($values as $key => $value) {
            DB::table('settings')->updateOrInsert(['key' => $key], ['value' => json_encode($value), 'updated_at' => $now]);
            DB::table('settings')->where('key', $key)->whereNull('created_at')->update(['created_at' => $now]);
        }
        $this->flush();
    }

    public function flush(): void
    {
        Cache::forget(self::CACHE_KEY);
        $this->values = null;
    }

    /*
     * Derived rules, used by Pricing, checkout validation, and GET /api/v1/store.
     */

    /** The enabled shipping methods: id => [id, label, eta, price_cents, free_over_threshold], in the config's order. */
    public function shippingMethods(): array
    {
        $enabled = $this->get('enabled_methods', []);
        $methods = [];
        foreach (config('buynest.store.shipping_methods') as $id => $method) {
            if (in_array($id, $enabled, true)) {
                $methods[$id] = [
                    'id' => $id,
                    'label' => $method['label'],
                    'eta' => $method['eta'],
                    'price_cents' => $this->cents($method['price_setting']),
                    'free_over_threshold' => $method['free_over_threshold'],
                ];
            }
        }

        return $methods;
    }

    /** The method a cart without a choice gets: standard if it's on, else the first enabled one. */
    public function defaultShippingMethod(): string
    {
        $ids = array_keys($this->shippingMethods());

        return in_array('standard', $ids, true) ? 'standard' : ($ids[0] ?? 'standard');
    }

    /** @return list<string> ids of the enabled payment methods (phase 12: minus those the store currency rules out) */
    public function paymentMethods(): array
    {
        return array_values(array_diff(
            array_intersect(array_keys(config('buynest.store.payment_methods')), $this->get('enabled_payment_methods', [])),
            Currency::unavailableMethods(),
        ));
    }

    /** Phase 6: what staff may choose for an order they create: the enabled methods, plus bank transfer and cash (admin only). */
    public function adminPaymentMethods(): array
    {
        return array_values(array_unique([...$this->paymentMethods(), ...array_keys(config('buynest.store.admin_payment_methods'))]));
    }

    /**
     * The tax rate for a shipping country, in hundredths of a percent
     * (19.00% → 1900), so tax can be calculated in integers. null: tax is
     * off, or the country has no rate (tax 0).
     */
    public function taxRateBasisPoints(?string $country): ?int
    {
        if (! $this->get('tax_enabled') || $country === null) {
            return null;
        }
        foreach ($this->get('tax_rates', []) as $rate) {
            if (mb_strtolower($rate['country']) === mb_strtolower(trim($country))) {
                return Pricing::toCents((string) $rate['rate']);
            }
        }

        return null;
    }

    /*
     * Validation for PATCH /api/admin/v1/settings { group: { key: value } }.
     */

    /** Rules per "group.key" (the field names errors are reported on). */
    public function rules(): array
    {
        $money = ['numeric', 'decimal:0,2', 'min:0', 'max:100000'];

        return [
            'general.store_name' => ['string', 'min:1', 'max:80'],
            'general.support_email' => ['nullable', 'string', 'email', 'max:190'],
            'general.support_phone' => ['nullable', 'string', 'max:40'],
            'general.address' => ['nullable', 'string', 'max:300'],
            'general.default_locale' => ['string', Rule::in(Locale::SUPPORTED)], // phase 13
            'general.bangla_digits' => ['boolean'],
            'shipping.standard_price' => $money,
            'shipping.free_shipping_threshold' => $money,
            'shipping.express_price' => $money,
            'shipping.next_day_price' => $money,
            'shipping.default_weight_grams' => ['integer', 'min:0', 'max:100000'], // phase 10 (part B)
            'shipping.enabled_methods' => ['array', 'min:1'],
            'shipping.enabled_methods.*' => ['string', 'distinct', Rule::in(array_keys(config('buynest.store.shipping_methods')))],
            'tax.tax_enabled' => ['boolean'],
            'tax.prices_include_tax' => ['boolean'],
            'tax.tax_rates' => ['array', 'max:250'],
            'tax.tax_rates.*.country' => ['required', 'string', 'min:2', 'max:60', 'distinct:ignore_case'],
            'tax.tax_rates.*.rate' => ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:100'],
            'checkout.allowed_countries' => ['array', 'min:1', 'max:250'],
            'checkout.allowed_countries.*' => ['string', 'min:2', 'max:60', 'distinct:ignore_case'],
            'checkout.guest_checkout' => ['boolean'],
            'checkout.enabled_payment_methods' => ['array', 'min:1'],
            'checkout.enabled_payment_methods.*' => ['string', 'distinct', Rule::in(array_keys(config('buynest.store.payment_methods')))],
            'inventory.low_stock_threshold' => ['integer', 'min:0', 'max:100000'],
            'catalog.reviews_require_approval' => ['boolean'],
            'returns.returns_enabled' => ['boolean'],
            'returns.return_window_days' => ['integer', 'min:1', 'max:365'],
            'returns.return_reasons' => ['array', 'min:1', 'max:20'],
            'returns.return_reasons.*' => ['string', 'min:1', 'max:60', 'distinct:ignore_case'],
            // Phase 9 (part A).
            'security.require_admin_two_factor' => ['boolean'],
            // Phase 10 (part A).
            'documents.paper_size' => ['string', Rule::in(['a4', 'letter'])],
            'documents.attach_pdf_to_emails' => ['boolean'],
            'analytics.ga4_measurement_id' => ['nullable', 'string', 'regex:/^G-[A-Z0-9]{4,12}$/'],
            // Phase 11.
            'rewards.enabled' => ['boolean'],
            'rewards.earn_rate' => ['numeric', 'decimal:0,2', 'min:0', 'max:1000'],
            'rewards.point_value' => ['numeric', 'decimal:0,4', 'min:0.0001', 'max:100'],
            'rewards.min_redeem' => ['integer', 'min:0', 'max:1000000'],
            'rewards.max_percent' => ['integer', 'min:1', 'max:100'],
            'rewards.signup_bonus' => ['integer', 'min:0', 'max:1000000'],
            'rewards.review_bonus' => ['integer', 'min:0', 'max:1000000'],
            // Phase 14 (default_country is also checked against allowed_countries by SettingsController).
            'checkout.default_country' => ['nullable', 'string', 'min:2', 'max:60'],
            'cod.max_order_total' => ['nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:100000000'],
            'cod.fee' => $money,
            'cod.advance' => ['string', Rule::in(CashOnDelivery::ADVANCE_MODES)],
            'cod.zones' => ['array', 'max:100'],
            'cod.zones.*' => ['string', 'distinct', 'max:40'],
            'cod.require_confirmation' => ['boolean'],
        ];
    }

    /** A validated value as it's stored: money and rates as "0.00" strings, booleans as booleans, trimmed text. */
    public function normalize(string $key, mixed $value): mixed
    {
        return match (true) {
            $key === 'bangla_digits' => filter_var($value, FILTER_VALIDATE_BOOLEAN), // phase 13
            $key === 'attach_pdf_to_emails' => filter_var($value, FILTER_VALIDATE_BOOLEAN), // phase 10 (part A)
            // Phase 11.
            $key === 'rewards_enabled' => filter_var($value, FILTER_VALIDATE_BOOLEAN),
            $key === 'rewards_earn_rate' => Pricing::format(Pricing::toCents((string) $value)),
            $key === 'rewards_point_value' => number_format(round((float) $value, 4), 4, '.', ''),
            in_array($key, ['rewards_min_redeem', 'rewards_max_percent', 'rewards_signup_bonus', 'rewards_review_bonus'], true) => (int) $value,
            in_array($key, self::MONEY_KEYS, true) => Pricing::format(Pricing::toCents((string) $value)),
            // Phase 14.
            $key === 'cod_max_order_total' => $value === null || $value === '' ? null : Pricing::format(Pricing::toCents((string) $value)),
            $key === 'cod_require_confirmation' => filter_var($value, FILTER_VALIDATE_BOOLEAN),
            $key === 'cod_zones' => array_values(array_map('trim', $value)),
            in_array($key, ['tax_enabled', 'prices_include_tax', 'guest_checkout', 'reviews_require_approval', 'returns_enabled',
                'require_admin_two_factor'], true) => filter_var($value, FILTER_VALIDATE_BOOLEAN), // phase 9 (part A): the last one
            in_array($key, ['low_stock_threshold', 'return_window_days', 'default_weight_grams'], true) => (int) $value, // phase 10 (part B): the last one
            $key === 'tax_rates' => array_values(array_map(fn ($rate) => [
                'country' => trim($rate['country']),
                'rate' => Pricing::format(Pricing::toCents((string) $rate['rate'])),
            ], $value)),
            in_array($key, ['allowed_countries', 'enabled_methods', 'enabled_payment_methods', 'return_reasons'], true) => array_values(array_map('trim', $value)),
            is_string($value) => trim($value) === '' ? null : trim($value),
            default => $value,
        };
    }
}
