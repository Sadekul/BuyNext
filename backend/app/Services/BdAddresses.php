<?php

namespace App\Services;

use App\Models\BdArea;
use App\Models\BdDistrict;
use App\Models\BdDivision;
use App\Support\Locale;

/**
 * Phase 14: Bangladesh addresses and mobile numbers.
 *
 * A Bangladesh address has country "Bangladesh" or "BD". It is *structured*
 * (division → district → area selects, see docs/BANGLADESH.md) when it sends
 * any of division_id / district_id / area_id, or when the store's default
 * country is Bangladesh; then the ids are required and must belong together,
 * the postcode is optional (4 digits), and city / state are filled from the
 * district and division (English), so documents, emails and exports that
 * read city / state keep working. Other addresses keep the phase 1 rules.
 */
class BdAddresses
{
    /** A Bangladeshi mobile number as stored: +880 1[3-9] and 8 digits. */
    public const MOBILE_RULE = 'regex:/^\+8801[3-9]\d{8}$/';

    public const POSTCODE_RULE = 'regex:/^\d{4}$/';

    public const ID_FIELDS = ['division_id', 'district_id', 'area_id'];

    public function __construct(private Settings $settings) {}

    public static function isBangladesh(mixed $country): bool
    {
        return is_string($country) && in_array(mb_strtolower(trim($country)), ['bd', 'bangladesh'], true);
    }

    /** The store's spelling of Bangladesh (from allowed_countries; "Bangladesh" when it isn't listed). */
    public function countryName(): string
    {
        foreach ((array) $this->settings->get('allowed_countries', []) as $name) {
            if (self::isBangladesh($name)) {
                return $name;
            }
        }

        return 'Bangladesh';
    }

    /** Is the store's default country Bangladesh (checkout.default_country)? */
    public function storeIsBangladeshi(): bool
    {
        return self::isBangladesh($this->settings->get('default_country'));
    }

    /** Does this address (as sent) use the structured Bangladesh rules? */
    public function structured(mixed $address): bool
    {
        if (! is_array($address) || ! self::isBangladesh($address['country'] ?? null)) {
            return false;
        }
        foreach (self::ID_FIELDS as $field) {
            if (($address[$field] ?? null) !== null && $address[$field] !== '') {
                return true;
            }
        }

        return $this->storeIsBangladeshi();
    }

    /** "BD" → the store's spelling; anything else unchanged. */
    public function normalizeCountry(mixed $country): mixed
    {
        return self::isBangladesh($country) ? $this->countryName() : $country;
    }

    /**
     * Bangladeshi mobile formats → "+8801XXXXXXXXX": "01712-345678",
     * "8801712345678", "+880 1712 345678", "00880…". Anything else is
     * returned cleaned (spaces, dashes, dots, brackets removed) for the
     * usual checks.
     */
    public static function normalizePhone(string $phone): string
    {
        $clean = preg_replace('/[\s().\-]/u', '', trim(self::latinDigits($phone)));
        if (str_starts_with($clean, '00')) {
            $clean = '+'.substr($clean, 2);
        }

        return match (true) {
            (bool) preg_match('/^01\d{9}$/', $clean) => '+88'.$clean,
            (bool) preg_match('/^8801\d{9}$/', $clean) => '+'.$clean,
            default => $clean,
        };
    }

    /** "০১৭১২" → "01712" (a phone typed with Bangla digits). */
    public static function latinDigits(string $text): string
    {
        return strtr($text, ['০' => '0', '১' => '1', '২' => '2', '৩' => '3', '৪' => '4', '৫' => '5', '৬' => '6', '৭' => '7', '৮' => '8', '৯' => '9']);
    }

    /** The validation rules of a structured address under $prefix ("" for a flat body, "shipping_address." for a nested one). */
    public static function rules(string $prefix, bool $required, bool $partial = false): array
    {
        $need = $partial ? ['sometimes', 'required'] : ($required ? ['required'] : ['nullable']);

        return [
            "{$prefix}division_id" => [...$need, 'integer', 'min:1'],
            "{$prefix}district_id" => [...$need, 'integer', 'min:1'],
            "{$prefix}area_id" => [...$need, 'integer', 'min:1'],
            "{$prefix}line1" => [...$need, 'string', 'max:120'],
            "{$prefix}city" => ['nullable', 'string', 'max:80'],
            "{$prefix}state" => ['nullable', 'string', 'max:80'],
            "{$prefix}postal_code" => ['nullable', 'string', self::POSTCODE_RULE],
        ];
    }

    public static function messages(string $prefix = '*.'): array
    {
        return [
            "{$prefix}postal_code.regex" => __('Enter a 4-digit postcode.'),
            "{$prefix}division_id.required" => __('Choose your division.'),
            "{$prefix}district_id.required" => __('Choose your district.'),
            "{$prefix}area_id.required" => __('Choose your area (upazila or thana).'),
        ];
    }

    public static function mobileMessage(): string
    {
        return __('Enter a Bangladeshi mobile number, for example 01712 345678.');
    }

    /**
     * Checks that the ids exist and belong together; [field => message] for
     * each problem ($prefix is put in front of the field names).
     */
    public function problems(array $address, string $prefix = ''): array
    {
        $division = BdDivision::find((int) ($address['division_id'] ?? 0));
        $district = BdDistrict::find((int) ($address['district_id'] ?? 0));
        $area = BdArea::find((int) ($address['area_id'] ?? 0));

        return array_filter([
            "{$prefix}division_id" => $division ? null : __('Choose your division.'),
            "{$prefix}district_id" => match (true) {
                ! $district => __('Choose your district.'),
                $division && $district->division_id !== $division->id => __('The district isn\'t in the chosen division.'),
                default => null,
            },
            "{$prefix}area_id" => match (true) {
                ! $area => __('Choose your area (upazila or thana).'),
                $district && $area->district_id !== $district->id => __('The area isn\'t in the chosen district.'),
                default => null,
            },
        ]);
    }

    /**
     * The stored form of a checked structured address: ids as ints, city and
     * state from the district and division (English), and `area` (English).
     */
    public function fill(array $address): array
    {
        $district = BdDistrict::with('division')->find((int) $address['district_id']);
        $area = BdArea::find((int) $address['area_id']);

        return [
            ...$address,
            'city' => $district?->name,
            'state' => $district?->division?->name,
            'country' => $this->countryName(),
            'division_id' => (int) $address['division_id'],
            'district_id' => (int) $address['district_id'],
            'area_id' => (int) $address['area_id'],
            'area' => $area?->name,
        ];
    }

    /** Is this stored address a structured Bangladesh one (it has the ids)? */
    public static function hasPlaces(?array $address): bool
    {
        return is_array($address) && self::isBangladesh($address['country'] ?? null) && ! empty($address['area_id']) && ! empty($address['district_id']);
    }

    /**
     * The address lines of a stored address in $locale: for a structured
     * Bangladesh address [line1, line2?, "Area, District", "Division postcode", country]
     * with the place names in Bangla for "bn"; null for other addresses.
     */
    public static function lines(?array $address, ?string $locale = null): ?array
    {
        if (! self::hasPlaces($address)) {
            return null;
        }
        $bangla = Locale::isBangla($locale);
        $area = BdArea::find((int) $address['area_id']);
        $district = BdDistrict::with('division')->find((int) $address['district_id']);
        $name = fn ($place, $fallback) => $place ? ($bangla ? $place->bn_name : $place->name) : $fallback;
        $postcode = filled($address['postal_code'] ?? null) ? Locale::digits($address['postal_code'], $locale) : null;

        return array_values(array_filter([
            $address['line1'] ?? null,
            $address['line2'] ?? null,
            implode(', ', array_filter([$name($area, $address['area'] ?? null), $name($district, $address['city'] ?? null)])),
            trim(implode(' ', array_filter([$name($district?->division, $address['state'] ?? null), $postcode]))),
            $bangla ? 'বাংলাদেশ' : ($address['country'] ?? 'Bangladesh'),
        ], fn ($line) => filled($line)));
    }
}
