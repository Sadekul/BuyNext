<?php

namespace App\Support;

use App\Services\Pricing;

/**
 * Phase 12: the store currency (BUYNEST_CURRENCY, a deployment setting) and
 * how money is written for people ("৳1,250.00", "$59.97").
 *
 * Prices in the database have no currency of their own: they are in the
 * store currency. Each order keeps the currency it was placed in
 * (orders.currency), so its documents stay right after a switch.
 */
final class Currency
{
    /** The store currency's code ("USD", "BDT"). */
    public static function store(): string
    {
        $code = strtoupper(trim((string) config('buynest.store.currency', 'USD')));

        return preg_match('/^[A-Z]{3}$/', $code) ? $code : 'USD';
    }

    /** { code, symbol, decimals } of $code (the store currency by default). */
    public static function info(?string $code = null): array
    {
        $code = strtoupper(trim((string) ($code ?: self::store())));
        $known = config("buynest.currencies.{$code}");

        return [
            'code' => $code,
            'symbol' => is_array($known) ? (string) $known['symbol'] : $code.' ',
            'decimals' => is_array($known) ? (int) ($known['decimals'] ?? 2) : 2,
        ];
    }

    /** The symbol as written before an amount ("৳", "$", or "XYZ " for an unknown code). */
    public static function symbol(?string $code = null): string
    {
        return self::info($code)['symbol'];
    }

    /** The public shape: { code, symbol, decimals } with the symbol trimmed. */
    public static function api(?string $code = null): array
    {
        $info = self::info($code);

        return ['code' => $info['code'], 'symbol' => trim($info['symbol']), 'decimals' => $info['decimals']];
    }

    /**
     * An API money string (or number) as a person reads it: "1250" → "৳1,250.00",
     * "-5" → "-৳5.00", null / not a number → "". $code: the order's currency
     * (the store currency by default).
     */
    public static function format(string|int|float|null $amount, ?string $code = null): string
    {
        if ($amount === null || $amount === '' || ! is_numeric($amount)) {
            return '';
        }

        return self::formatCents(Pricing::toCents((string) $amount), $code);
    }

    /** Cents as a person reads them (see format()). */
    public static function formatCents(int $cents, ?string $code = null): string
    {
        $info = self::info($code);

        return ($cents < 0 ? '-' : '').$info['symbol'].number_format(abs($cents) / 100, $info['decimals']);
    }

    /** Does PayPal accept $code (the store currency by default)? */
    public static function paypalAccepts(?string $code = null): bool
    {
        return in_array(strtoupper((string) ($code ?: self::store())), (array) config('buynest.paypal.currencies', []), true);
    }

    /** Does the SSLCommerz integration charge in $code (BDT only in phase 12)? */
    public static function sslcommerzAccepts(?string $code = null): bool
    {
        return in_array(strtoupper((string) ($code ?: self::store())), (array) config('buynest.sslcommerz.currencies', ['BDT']), true);
    }

    /** Payment methods that can't be used in the store currency (PayPal in taka, SSLCommerz outside taka). */
    public static function unavailableMethods(): array
    {
        return array_values(array_filter([
            self::paypalAccepts() ? null : 'paypal',
            self::sslcommerzAccepts() ? null : 'sslcommerz',
        ]));
    }
}
