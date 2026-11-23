<?php

namespace App\Support;

use App\Models\Customer;
use App\Models\Order;
use App\Services\Settings;
use DateTimeInterface;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\App;

/**
 * Phase 13: the store's languages, English (en, the default) and Bangla (bn).
 *
 * - The request's language is set by App\Http\Middleware\SetLocale from
 *   Accept-Language (admin routes are always English).
 * - Emails use the customer's saved language (customers.locale), else the
 *   language the order was placed in (orders.locale), else the store default.
 * - With Bangla and the store setting bangla_digits (default on), numbers,
 *   prices and dates are written with Bangla digits (০–৯).
 */
final class Locale
{
    public const SUPPORTED = ['en', 'bn'];

    public const FALLBACK = 'en';

    private const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

    /** "bn", "bn-BD", "BN_bd" → "bn"; "en-US" → "en"; anything else → null. */
    public static function normalize(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $primary = strtolower(trim(explode('-', str_replace('_', '-', trim($value)))[0]));

        return in_array($primary, self::SUPPORTED, true) ? $primary : null;
    }

    /** The language Accept-Language asks for: its first (highest-weighted) entry when that is en or bn, else null. */
    public static function requested(Request $request): ?string
    {
        $header = trim((string) $request->header('Accept-Language'));
        if ($header === '') {
            return null;
        }
        $best = null;
        $bestWeight = -1.0;
        foreach (explode(',', $header) as $part) {
            $pieces = array_map('trim', explode(';', $part));
            $weight = 1.0;
            foreach (array_slice($pieces, 1) as $param) {
                if (preg_match('/^q=([0-9.]+)$/i', $param, $m)) {
                    $weight = (float) $m[1];
                }
            }
            if ($pieces[0] !== '' && $weight > $bestWeight) {
                [$best, $bestWeight] = [$pieces[0], $weight];
            }
        }

        return self::normalize($best);
    }

    /** The store's default language (Settings → General, `default_locale`). */
    public static function storeDefault(): string
    {
        try {
            return self::normalize(app(Settings::class)->get('default_locale')) ?? self::FALLBACK;
        } catch (\Throwable) {
            return self::FALLBACK; // no settings table yet (fresh install, migrations running)
        }
    }

    /** The language in use now (the request's, or the one a mail is being rendered in). */
    public static function current(): string
    {
        return self::normalize(App::getLocale()) ?? self::FALLBACK;
    }

    public static function isBangla(?string $locale = null): bool
    {
        return ($locale ?? self::current()) === 'bn';
    }

    /** Does the store write Bangla digits in Bangla (Settings → General, `bangla_digits`, default on)? */
    public static function banglaDigitsEnabled(): bool
    {
        try {
            return (bool) app(Settings::class)->get('bangla_digits', true);
        } catch (\Throwable) {
            return true;
        }
    }

    /** Does $locale (the current one by default) write numbers with Bangla digits? */
    public static function usesBanglaDigits(?string $locale = null): bool
    {
        return self::isBangla($locale) && self::banglaDigitsEnabled();
    }

    /** Swaps 0–9 for ০–৯ when $locale (the current one by default) uses Bangla digits; other text stays. */
    public static function digits(string|int|float|null $text, ?string $locale = null): string
    {
        $text = (string) $text;

        return self::usesBanglaDigits($locale) ? strtr($text, array_combine(range(0, 9), self::BANGLA_DIGITS)) : $text;
    }

    /** A whole number with thousands separators in $locale ("1,250" / "১,২৫০"). */
    public static function number(int|float $number, int $decimals = 0, ?string $locale = null): string
    {
        return self::digits(number_format($number, $decimals), $locale);
    }

    /**
     * A date in $locale: $format is a PHP date format; month and day names are
     * translated (Carbon's bn names: "নভেম্বর") and digits follow the setting.
     * Default format: "19 November 2026" / "১৯ নভেম্বর ২০২৬".
     */
    public static function date(DateTimeInterface|string|null $date, ?string $locale = null, string $format = 'j F Y'): string
    {
        if ($date === null || $date === '') {
            return '';
        }
        $locale ??= self::current();
        $carbon = Carbon::parse($date)->locale($locale);

        return self::digits($carbon->translatedFormat($format), $locale);
    }

    /** The customer's saved language, or null (= use the request's / store default). */
    public static function forCustomer(?Customer $customer): ?string
    {
        return $customer ? self::normalize($customer->locale) : null;
    }

    /** The language of an order's emails and documents: the customer's choice, else the order's, else the store default. */
    public static function forOrder(?Order $order): string
    {
        if (! $order) {
            return self::storeDefault();
        }

        return self::forCustomer($order->relationLoaded('customer') ? $order->customer : ($order->customer_id ? $order->customer()->first() : null))
            ?? self::normalize($order->locale)
            ?? self::storeDefault();
    }
}
