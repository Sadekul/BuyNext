<?php

namespace App\Services;

use App\Models\ShippingRate;
use App\Support\Locale;
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

    /**
     * The first row of $method matching the cart (exact country first, then "*"), or null.
     * Phase 14: rows of the address's delivery zone ($zone) come before both.
     */
    public function match(string $method, ?string $country, int $weightGrams, int $subtotalCents, ?string $zone = null): ?ShippingRate
    {
        $rows = $this->rows()->get($method, collect());
        $matching = $rows->filter(fn (ShippingRate $rate) => $rate->matches($country, $weightGrams, $subtotalCents, $zone));

        return $matching->first(fn (ShippingRate $rate) => $rate->zone_code !== null)
            ?? $matching->first(fn (ShippingRate $rate) => $rate->country !== '*')
            ?? $matching->first();
    }

    /**
     * Prices for the enabled methods (Settings::shippingMethods()):
     * id => [id, label, eta, price_cents, free_over_threshold, source, rate_id, zone_code, eta_days_min, eta_days_max],
     * leaving out methods whose table has no matching row.
     * Phase 14: $zone is the address's delivery zone code; a matched row's
     * eta days replace the method's ETA text (etaText()).
     */
    public function options(array $methods, ?string $country, int $weightGrams, int $subtotalCents, ?string $zone = null): array
    {
        $options = [];
        // Phase 14: zone rows only describe Bangladesh. For any other country a method whose rows are
        // all zone rows still has its flat price (a zone price must never take Standard away abroad).
        $abroad = $country !== null && ! in_array(mb_strtolower($country), ['bangladesh', 'bd'], true);
        foreach ($methods as $id => $method) {
            $ownRows = $this->rows()->get($id, collect());
            if (! $this->hasRows($id) || ($abroad && $ownRows->every(fn (ShippingRate $rate) => $rate->zone_code !== null))) {
                $options[$id] = [...$method, 'source' => 'flat', 'rate_id' => null, 'zone_code' => null, 'eta_days_min' => null, 'eta_days_max' => null];

                continue;
            }
            $rate = $this->match($id, $country, $weightGrams, $subtotalCents, $zone);
            if ($rate) {
                $days = $rate->eta_days_min !== null || $rate->eta_days_max !== null;
                $options[$id] = [...$method, 'price_cents' => Pricing::toCents($rate->price), 'source' => 'table', 'rate_id' => $rate->id,
                    'zone_code' => $rate->zone_code, 'eta_days_min' => $rate->eta_days_min ?? $rate->eta_days_max,
                    'eta_days_max' => $rate->eta_days_max ?? $rate->eta_days_min,
                    'eta' => $days ? self::etaText($rate->eta_days_min ?? $rate->eta_days_max, $rate->eta_days_max ?? $rate->eta_days_min, 'en') : $method['eta']];
            }
        }

        return $options;
    }

    /**
     * Phase 14: "Delivery in 1–2 days" / "Delivery in 1 day" (in $locale, the
     * request's by default: "১–২ দিনে ডেলিভারি" with the digits setting).
     */
    public static function etaText(?int $min, ?int $max, ?string $locale = null): ?string
    {
        if ($min === null && $max === null) {
            return null;
        }
        $min ??= $max;
        $max ??= $min;
        $replace = ['min' => Locale::digits($min, $locale), 'max' => Locale::digits($max, $locale),
            'days' => Locale::digits($max, $locale)];

        return match (true) {
            $min === $max && $max === 1 => __('Delivery in :days day', $replace, $locale),
            $min === $max => __('Delivery in :days days', $replace, $locale),
            default => __('Delivery in :min–:max days', $replace, $locale),
        };
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
