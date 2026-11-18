<?php

namespace App\Services\Payments;

use Illuminate\Support\Facades\DB;

/**
 * Phase 10 (part B): webhook events already handled, per provider
 * (payment_events, key provider + event id). Phase 8's stripe_events
 * generalised: Stripe and PayPal both retry an event until they get a 200,
 * so each event id must be handled once.
 *
 * Call claim() inside the transaction that handles the event: if handling
 * throws, the row is rolled back too and the provider's retry runs it again.
 */
class PaymentEvents
{
    /** true the first time (provider, id) is seen; false for a repeat. */
    public static function claim(string $provider, string $id, string $type): bool
    {
        return DB::table('payment_events')->insertOrIgnore([
            'provider' => $provider,
            'id' => mb_substr($id, 0, 191),
            'type' => mb_substr($type, 0, 100),
            'created_at' => now(),
        ]) > 0;
    }

    public static function processed(string $provider, string $id): void
    {
        DB::table('payment_events')->where('provider', $provider)->where('id', mb_substr($id, 0, 191))->update(['processed_at' => now()]);
    }
}
