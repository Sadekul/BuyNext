<?php

namespace App\Services;

use App\Models\ShippingRate;
use Illuminate\Support\Collection;

/**
 * Phase 10 (part B): shipping table rates. A method with any rows takes its
 * price from the first row matching the cart (exact country before "*", then
 * position, then id); no matching row → the method isn't offered. A method
 * without rows keeps its flat price from the settings (phase 4).
 *
 * The store keeps countries as names (Settings → Checkout), so rows do too;
 * ISO 3166 alpha-2 codes are accepted on input (normalizeCountry()).
 */
class ShippingRates
{
    /** A few ISO codes → the names the store uses (the defaults of Settings → Checkout and common neighbours). */
    public const ISO_COUNTRIES = [
        'US' => 'United States', 'CA' => 'Canada', 'GB' => 'United Kingdom', 'UK' => 'United Kingdom', 'AU' => 'Australia',
        'DE' => 'Germany', 'BD' => 'Bangladesh', 'IN' => 'India', 'FR' => 'France', 'IT' => 'Italy', 'ES' => 'Spain',
        'NL' => 'Netherlands', 'BE' => 'Belgium', 'AT' => 'Austria', 'CH' => 'Switzerland', 'IE' => 'Ireland', 'PT' => 'Portugal',
        'SE' => 'Sweden', 'NO' => 'Norway', 'DK' => 'Denmark', 'FI' => 'Finland', 'PL' => 'Poland', 'NZ' => 'New Zealand',
        'JP' => 'Japan', 'CN' => 'China', 'SG' => 'Singapore', 'AE' => 'United Arab Emirates', 'PK' => 'Pakistan',
        'BR' => 'Brazil', 'MX' => 'Mexico', 'ZA' => 'South Africa',
    ];

    /** Rows of this request, by method (null = not loaded yet). */
    private ?Collection $rows = null;

    /** All rows by method, in matching order. */
    public function rows(): Collection
    {
        return $this->rows ??= ShippingRate::orderBy('method')->orderBy('position')->orderBy('id')->get()->groupBy('method');
    }

    /** Forget the loaded rows (after the admin changed them). */
    public function flush(): void
    {
        $this->rows = null;
    }

    public function hasRows(string $method): bool
    {
        return $this->rows()->has($method);
    }

    /** The first row of $method matching the cart (exact country first, then "*"), or null. */
    public function match(string $method, ?string $country, int $weightGrams, int $subtotalCents): ?ShippingRate
    {
        $rows = $this->rows()->get($method, collect());
        $matching = $rows->filter(fn (ShippingRate $rate) => $rate->matches($country, $weightGrams, $subtotalCents));

        return $matching->first(fn (ShippingRate $rate) => $rate->country !== '*') ?? $matching->first();
    }

    /**
     * Prices for the enabled methods (Settings::shippingMethods()):
     * id => [id, label, eta, price_cents, free_over_threshold, source, rate_id],
     * leaving out methods whose table has no matching row.
     */
    public function options(array $methods, ?string $country, int $weightGrams, int $subtotalCents): array
    {
        $options = [];
        foreach ($methods as $id => $method) {
            if (! $this->hasRows($id)) {
                $options[$id] = [...$method, 'source' => 'flat', 'rate_id' => null];

                continue;
            }
            $rate = $this->match($id, $country, $weightGrams, $subtotalCents);
            if ($rate) {
                $options[$id] = [...$method, 'price_cents' => Pricing::toCents($rate->price), 'source' => 'table', 'rate_id' => $rate->id];
            }
        }

        return $options;
    }

    /** "*", a store country name, or an ISO code → what is stored ("*" or the name); null when unknown. */
    public static function normalizeCountry(?string $country, array $allowed): ?string
    {
        $country = trim((string) $country);
        if ($country === '' || $country === '*') {
            return '*';
        }
        $name = self::ISO_COUNTRIES[strtoupper($country)] ?? $country;
        foreach ($allowed as $allowedName) {
            if (mb_strtolower($allowedName) === mb_strtolower($name)) {
                return $allowedName;
            }
        }

        return strlen($country) === 2 && isset(self::ISO_COUNTRIES[strtoupper($country)]) ? $name : null;
    }
}
