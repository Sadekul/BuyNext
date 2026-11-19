<?php

namespace App\Services\Payments;

use App\Support\Currency;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Phase 10 (part B): the only class that talks to PayPal (REST, Orders API
 * v2). No SDK: Laravel's HTTP client (tests use Http::fake()).
 *
 * - OAuth 2 client credentials: the access token is cached until a minute
 *   before PayPal says it expires; a 401 drops it and the call is retried once.
 * - Every POST carries a PayPal-Request-Id, so a retried request (timeout,
 *   double click) never creates a second order, capture, or refund.
 * - Failures are logged with PayPal's error name, issue, and debug id, never
 *   the client secret or the token.
 * - Base URL: PAYPAL_API_URL, else sandbox or live by PAYPAL_MODE.
 */
class PayPalGateway
{
    /** On when the client id and secret are set. */
    public function enabled(): bool
    {
        return filled(config('buynest.paypal.client_id')) && filled(config('buynest.paypal.client_secret'));
    }

    public function live(): bool
    {
        return config('buynest.paypal.mode') === 'live';
    }

    public function currency(): string
    {
        return Currency::store();
    }

    /** POST /v2/checkout/orders → PayPal's order (id, status, links, ...). */
    public function createOrder(array $payload, string $requestId): array
    {
        return $this->send('post', '/v2/checkout/orders', $payload, $requestId, ['Prefer' => 'return=representation']);
    }

    /** POST /v2/checkout/orders/{id}/capture → the order with purchase_units[0].payments.captures. */
    public function captureOrder(string $orderId, string $requestId): array
    {
        return $this->send('post', '/v2/checkout/orders/'.rawurlencode($orderId).'/capture', null, $requestId, ['Prefer' => 'return=representation']);
    }

    /** GET /v2/checkout/orders/{id}. */
    public function getOrder(string $orderId): array
    {
        return $this->send('get', '/v2/checkout/orders/'.rawurlencode($orderId));
    }

    /** POST /v2/payments/captures/{id}/refund → the refund (id, status). */
    public function refundCapture(string $captureId, string $amount, string $requestId, ?string $note = null, ?string $currency = null): array
    {
        return $this->send('post', '/v2/payments/captures/'.rawurlencode($captureId).'/refund', array_filter([
            'amount' => ['value' => $amount, 'currency_code' => $currency ?? $this->currency()], // phase 12: the order's currency
            'note_to_payer' => $note,
        ]), $requestId);
    }

    /**
     * Verifies a webhook with PayPal (POST /v1/notifications/verify-webhook-signature)
     * and returns the event, or null when the headers, the webhook id, or
     * PayPal's verdict say it isn't genuine. Throws PayPalException when
     * PayPal can't be reached (the caller answers 503, PayPal retries).
     *
     * @param  array<string, string|null>  $headers  lower-case header name => value
     */
    public function verifyWebhook(string $payload, array $headers): ?array
    {
        $webhookId = (string) config('buynest.paypal.webhook_id');
        $event = json_decode($payload, true);
        $needed = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
        if ($webhookId === '' || ! $this->enabled() || ! is_array($event) || ! is_string($event['id'] ?? null) || ! is_string($event['event_type'] ?? null)) {
            return null;
        }
        foreach ($needed as $name) {
            if (blank($headers[$name] ?? null)) {
                return null;
            }
        }

        try {
            $answer = $this->send('post', '/v1/notifications/verify-webhook-signature', [
                'auth_algo' => $headers['paypal-auth-algo'],
                'cert_url' => $headers['paypal-cert-url'],
                'transmission_id' => $headers['paypal-transmission-id'],
                'transmission_sig' => $headers['paypal-transmission-sig'],
                'transmission_time' => $headers['paypal-transmission-time'],
                'webhook_id' => $webhookId,
                'webhook_event' => $event,
            ], 'verify-'.$headers['paypal-transmission-id']);
        } catch (PayPalException $e) {
            if ($e->unreachable) {
                throw $e;
            }

            return null; // PayPal refused the check itself (e.g. a malformed event): not verified
        }

        return ($answer['verification_status'] ?? null) === 'SUCCESS' ? $event : null;
    }

    /** The cached OAuth access token (client credentials). */
    private function token(bool $fresh = false): string
    {
        $key = 'buynest.paypal.token.'.hash('sha256', config('buynest.paypal.api_url').'|'.config('buynest.paypal.client_id'));
        if ($fresh) {
            Cache::forget($key);
        }
        if (is_string($token = Cache::get($key))) {
            return $token;
        }

        try {
            $response = Http::withBasicAuth((string) config('buynest.paypal.client_id'), (string) config('buynest.paypal.client_secret'))
                ->asForm()->acceptJson()->connectTimeout(5)->timeout((int) config('buynest.paypal.timeout_seconds'))
                ->post($this->url('/v1/oauth2/token'), ['grant_type' => 'client_credentials']);
        } catch (Throwable $e) {
            Log::warning('PayPal could not be reached for a token.', ['exception' => $e::class]);
            throw new PayPalException('PayPal could not be reached. Please try again in a moment.', unreachable: true);
        }
        $token = $response->json('access_token');
        if (! $response->successful() || ! is_string($token) || $token === '') {
            Log::error('PayPal refused the client credentials.', ['status' => $response->status(), 'error' => $response->json('error'),
                'debug_id' => $response->header('Paypal-Debug-Id') ?: null]);
            throw new PayPalException($response->serverError() ? 'PayPal is having trouble right now. Please try again in a moment.'
                : 'PayPal refused the store\'s credentials (check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET).', unreachable: $response->serverError());
        }
        // Kept until a minute before it expires (PayPal's tokens last about 9 hours).
        Cache::put($key, $token, max(60, (int) $response->json('expires_in', 3600) - 60));

        return $token;
    }

    private function send(string $method, string $path, ?array $payload = null, ?string $requestId = null, array $headers = []): array
    {
        if (! $this->enabled()) {
            throw new PayPalException('PayPal payments are not set up (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are empty).');
        }

        $response = $this->attempt($method, $path, $payload, $requestId, $headers, $this->token());
        if ($response->status() === 401) {
            // The cached token was revoked or expired early: get a new one, once.
            $response = $this->attempt($method, $path, $payload, $requestId, $headers, $this->token(fresh: true));
        }

        $body = $response->json();
        if ($response->successful()) {
            return is_array($body) ? $body : [];
        }

        $issue = is_array($body['details'][0] ?? null) ? ($body['details'][0]['issue'] ?? null) : null;
        $description = is_array($body['details'][0] ?? null) ? ($body['details'][0]['description'] ?? null) : null;
        Log::warning('PayPal refused a request.', [
            'path' => $path,
            'status' => $response->status(),
            'name' => $body['name'] ?? null,
            'issue' => $issue,
            'message' => $body['message'] ?? null,
            'debug_id' => $body['debug_id'] ?? ($response->header('Paypal-Debug-Id') ?: null),
            'request_id' => $requestId,
        ]);

        $message = match (true) {
            $response->serverError() => 'PayPal is having trouble right now. Please try again in a moment.',
            is_string($description) && $description !== '' => $description,
            is_string($body['message'] ?? null) && $body['message'] !== '' => $body['message'],
            default => 'PayPal refused the request.',
        };

        throw new PayPalException($message, is_string($issue) ? $issue : null, $response->serverError());
    }

    private function attempt(string $method, string $path, ?array $payload, ?string $requestId, array $headers, string $token): Response
    {
        try {
            $request = Http::withToken($token)->acceptJson()->asJson()->connectTimeout(5)
                ->timeout((int) config('buynest.paypal.timeout_seconds'))
                ->withHeaders([...$headers, ...($requestId !== null ? ['PayPal-Request-Id' => $requestId] : [])]);

            return $method === 'get' ? $request->get($this->url($path)) : $this->post($request, $path, $payload);
        } catch (ConnectionException $e) {
            Log::warning('PayPal could not be reached.', ['path' => $path, 'request_id' => $requestId]);
            throw new PayPalException('PayPal could not be reached. Please try again in a moment.', unreachable: true);
        } catch (Throwable $e) {
            Log::error('PayPal request failed before an answer.', ['path' => $path, 'request_id' => $requestId, 'exception' => $e::class]);
            throw new PayPalException('PayPal could not be reached. Please try again in a moment.', unreachable: true);
        }
    }

    /** A POST without a payload (capture) sends an empty JSON body. */
    private function post(PendingRequest $request, string $path, ?array $payload): Response
    {
        return $payload === null
            ? $request->withBody('', 'application/json')->post($this->url($path))
            : $request->post($this->url($path), $payload);
    }

    private function url(string $path): string
    {
        return rtrim((string) config('buynest.paypal.api_url'), '/').$path;
    }
}
