<?php

namespace App\Services\Payments;

use App\Support\Currency;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Phase 8: the only class that talks to Stripe. No SDK: Stripe's REST API
 * through Laravel's HTTP client (tests use Http::fake()).
 *
 * - Requests are form-encoded, with nested keys written out the way Stripe
 *   expects them (line_items[0][price_data][unit_amount]=1999).
 * - Authorization: Bearer <secret key>; every POST carries an
 *   Idempotency-Key, so a retried request (timeout, double click) never
 *   creates a second session or refund.
 * - Failures are logged with Stripe's error type and message, never the key.
 *
 * Webhook signatures are checked here too (verifyWebhook).
 */
class StripeGateway
{
    /** On when the secret key is set. */
    public function enabled(): bool
    {
        return filled(config('buynest.stripe.secret_key'));
    }

    public function currency(): string
    {
        // Phase 12: always the store currency (STRIPE_CURRENCY is gone), lower case as Stripe writes it.
        return strtolower(Currency::store());
    }

    /** A Checkout Session (Stripe's answer: id, url, expires_at, ...). */
    public function createCheckoutSession(array $params, string $idempotencyKey): array
    {
        return $this->post('checkout/sessions', $params, $idempotencyKey);
    }

    /** Closes a session that is still open, so it can no longer be paid. */
    public function expireCheckoutSession(string $sessionId, string $idempotencyKey): array
    {
        return $this->post('checkout/sessions/'.rawurlencode($sessionId).'/expire', [], $idempotencyKey);
    }

    /** A refund of $amountCents of the PaymentIntent (Stripe's answer: id, status, ...). */
    public function createRefund(string $paymentIntent, int $amountCents, string $idempotencyKey, array $metadata = []): array
    {
        return $this->post('refunds', ['payment_intent' => $paymentIntent, 'amount' => $amountCents, 'metadata' => $metadata], $idempotencyKey);
    }

    /**
     * Checks the Stripe-Signature header ("t=1700000000,v1=abc...,v1=def...")
     * and returns the event, or null when the signature, the timestamp, or the
     * body is not valid. The signature is HMAC-SHA256 of "{t}.{raw body}" with
     * the webhook secret; any of the v1 signatures may match (Stripe sends
     * several while a secret is being rolled). The timestamp must be within
     * the tolerance (5 minutes), so an old request can't be replayed.
     */
    public function verifyWebhook(string $payload, ?string $header): ?array
    {
        $secret = (string) config('buynest.stripe.webhook_secret');
        if ($secret === '' || ! $header) {
            return null;
        }

        $timestamp = null;
        $signatures = [];
        foreach (explode(',', $header) as $part) {
            [$key, $value] = array_pad(explode('=', trim($part), 2), 2, '');
            if ($key === 't' && ctype_digit($value)) {
                $timestamp = (int) $value;
            } elseif ($key === 'v1' && $value !== '') {
                $signatures[] = $value;
            }
        }
        if ($timestamp === null || $signatures === []) {
            return null;
        }
        if (abs(now()->getTimestamp() - $timestamp) > (int) config('buynest.stripe.webhook_tolerance_seconds')) {
            return null;
        }

        $expected = hash_hmac('sha256', "{$timestamp}.{$payload}", $secret);
        $valid = false;
        foreach ($signatures as $signature) {
            // Constant-time compare (and no early exit), so timing tells nothing about the secret.
            $valid = hash_equals($expected, $signature) || $valid;
        }
        if (! $valid) {
            return null;
        }

        $event = json_decode($payload, true);

        return is_array($event) && is_string($event['id'] ?? null) && is_string($event['type'] ?? null) ? $event : null;
    }

    /** The Stripe-Signature header for $payload (tests, and the e2e script's signed test webhook). */
    public static function signature(string $payload, string $secret, ?int $timestamp = null): string
    {
        $timestamp ??= now()->getTimestamp();

        return "t={$timestamp},v1=".hash_hmac('sha256', "{$timestamp}.{$payload}", $secret);
    }

    /**
     * Stripe's form encoding: nested arrays become bracketed keys
     * (["metadata" => ["order_number" => "BN-1"]] → metadata[order_number]),
     * booleans "true"/"false", nulls left out.
     */
    public static function encode(array $params, string $prefix = ''): array
    {
        $flat = [];
        foreach ($params as $key => $value) {
            $name = $prefix === '' ? (string) $key : "{$prefix}[{$key}]";
            if (is_array($value)) {
                $flat += self::encode($value, $name);
            } elseif (is_bool($value)) {
                $flat[$name] = $value ? 'true' : 'false';
            } elseif ($value !== null) {
                $flat[$name] = (string) $value;
            }
        }

        return $flat;
    }

    private function post(string $path, array $params, string $idempotencyKey): array
    {
        if (! $this->enabled()) {
            throw new StripeException('Card payments through Stripe are not set up (STRIPE_SECRET_KEY is empty).');
        }

        try {
            $response = Http::withToken((string) config('buynest.stripe.secret_key'))
                ->withHeaders(['Idempotency-Key' => $idempotencyKey])
                ->asForm()
                ->acceptJson()
                ->connectTimeout(5)
                ->timeout((int) config('buynest.stripe.timeout_seconds'))
                ->post(rtrim((string) config('buynest.stripe.api_url'), '/').'/'.$path, self::encode($params));
        } catch (ConnectionException $e) {
            Log::warning('Stripe could not be reached.', ['path' => $path, 'idempotency_key' => $idempotencyKey]);
            throw new StripeException('Stripe could not be reached. Please try again in a moment.');
        } catch (Throwable $e) {
            Log::error('Stripe request failed before an answer.', ['path' => $path, 'idempotency_key' => $idempotencyKey, 'exception' => $e::class]);
            throw new StripeException('Stripe could not be reached. Please try again in a moment.');
        }

        $body = $response->json();
        if ($response->successful() && is_array($body)) {
            return $body;
        }

        $error = is_array($body['error'] ?? null) ? $body['error'] : [];
        Log::warning('Stripe refused a request.', [
            'path' => $path,
            'status' => $response->status(),
            'type' => $error['type'] ?? null,
            'code' => $error['code'] ?? null,
            'message' => $error['message'] ?? null,
            'request_id' => $response->header('Request-Id') ?: null,
            'idempotency_key' => $idempotencyKey,
        ]);

        $message = is_string($error['message'] ?? null) && $error['message'] !== ''
            ? $error['message']
            : ($response->serverError() ? 'Stripe is having trouble right now. Please try again in a moment.' : 'Stripe refused the request.');

        throw new StripeException($message);
    }
}
