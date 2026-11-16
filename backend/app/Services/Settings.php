<?php

namespace App\Services;

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
        'general' => ['store_name', 'support_email', 'support_phone', 'address'],
        'shipping' => ['standard_price', 'free_shipping_threshold', 'express_price', 'next_day_price', 'enabled_methods'],
        'tax' => ['tax_enabled', 'tax_rates', 'prices_include_tax'],
        'checkout' => ['allowed_countries', 'guest_checkout', 'enabled_payment_methods'],
        'inventory' => ['low_stock_threshold'],
        // Phase 5: Settings → Catalog. The contract calls it reviews.require_approval.
        'catalog' => ['reviews_require_approval'],
    ];

    public const DEFAULTS = [
        'store_name' => 'BuyNest',
        'support_email' => 'support@buynest.example.com',
        'support_phone' => '+1 (555) 010-2030',
        'address' => null,
        'standard_price' => '4.99',
        'free_shipping_threshold' => '50.00',
        'express_price' => '12.99',
        'next_day_price' => '24.99',
        'enabled_methods' => ['standard', 'express', 'nextDay'],
        'tax_enabled' => false,
        'tax_rates' => [], // [{ country: "Germany", rate: "19.00" }] (percent)
        'prices_include_tax' => false,
        'allowed_countries' => ['United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'Bangladesh', 'India'],
        'guest_checkout' => true,
        'enabled_payment_methods' => ['card', 'paypal', 'cod'],
        'low_stock_threshold' => 10,
        'reviews_require_approval' => true, // false: new reviews are public at once
    ];

    private const MONEY_KEYS = ['standard_price', 'free_shipping_threshold', 'express_price', 'next_day_price'];

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
        return array_map(fn (array $keys) => array_combine($keys, array_map(fn ($key) => $this->get($key), $keys)), self::GROUPS);
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

    /** @return list<string> ids of the enabled payment methods */
    public function paymentMethods(): array
    {
        return array_values(array_intersect(array_keys(config('buynest.store.payment_methods')), $this->get('enabled_payment_methods', [])));
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
            'shipping.standard_price' => $money,
            'shipping.free_shipping_threshold' => $money,
            'shipping.express_price' => $money,
            'shipping.next_day_price' => $money,
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
        ];
    }

    /** A validated value as it's stored: money and rates as "0.00" strings, booleans as booleans, trimmed text. */
    public function normalize(string $key, mixed $value): mixed
    {
        return match (true) {
            in_array($key, self::MONEY_KEYS, true) => Pricing::format(Pricing::toCents((string) $value)),
            in_array($key, ['tax_enabled', 'prices_include_tax', 'guest_checkout', 'reviews_require_approval'], true) => filter_var($value, FILTER_VALIDATE_BOOLEAN),
            $key === 'low_stock_threshold' => (int) $value,
            $key === 'tax_rates' => array_values(array_map(fn ($rate) => [
                'country' => trim($rate['country']),
                'rate' => Pricing::format(Pricing::toCents((string) $rate['rate'])),
            ], $value)),
            in_array($key, ['allowed_countries', 'enabled_methods', 'enabled_payment_methods'], true) => array_values(array_map('trim', $value)),
            is_string($value) => trim($value) === '' ? null : trim($value),
            default => $value,
        };
    }
}
