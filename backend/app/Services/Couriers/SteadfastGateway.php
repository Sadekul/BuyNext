<?php

namespace App\Services\Couriers;

use App\Models\Shipment;
use App\Services\Pricing;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Phase 18: the only class that talks to Steadfast Courier (Packzy merchant
 * API). No SDK: Laravel's HTTP client (tests use Http::fake()).
 *
 * The wire format below is from Steadfast's published merchant API and
 * community SDKs; it has NOT yet been verified against a real Steadfast
 * account. Verify it with sandbox credentials before going live
 * (docs/BANGLADESH.md → Couriers); a correction is a change to this file only.
 *
 * - Every request carries the headers Api-Key and Secret-Key (never logged).
 * - Book: POST {api}/create_order { invoice, recipient_name, recipient_phone,
 *   recipient_address (≤ 250), cod_amount (taka, decimals allowed), note }
 *   → { status: 200, consignment: { consignment_id, tracking_code, status } }.
 * - Status: GET {api}/status_by_cid/{consignment_id} → { status: 200, delivery_status }.
 * - Balance: GET {api}/get_balance → { status: 200, current_balance }.
 * - Webhook: Steadfast posts { notification_type: delivery_status | tracking_update,
 *   consignment_id, invoice, cod_amount, status, delivery_charge, tracking_message,
 *   updated_at } with "Authorization: Bearer {STEADFAST_WEBHOOK_TOKEN}".
 * - Failures are logged with Steadfast's status and reason only: never the
 *   keys, never the recipient's details.
 */
class SteadfastGateway implements CourierGateway
{
    /** Steadfast's raw statuses → ours (anything else: in_transit). */
    public const STATUS_MAP = [
        'pending' => 'booked',
        'in_review' => 'booked',
        'hold' => 'on_hold',
        'delivered' => 'delivered',
        'delivered_approval_pending' => 'delivered',
        'partial_delivered' => 'partly_delivered',
        'partial_delivered_approval_pending' => 'partly_delivered',
        'cancelled' => 'cancelled',
        'cancelled_approval_pending' => 'cancelled',
        'unknown' => 'on_hold',
        'unknown_approval_pending' => 'on_hold',
    ];

    public function key(): string
    {
        return 'steadfast';
    }

    public function label(): string
    {
        return 'Steadfast';
    }

    public function configured(): bool
    {
        return filled($this->config('api_key')) && filled($this->config('secret_key'));
    }

    public function mode(): ?string
    {
        return null;
    }

    public function book(array $parcel): BookingResult
    {
        $invoice = (string) $parcel['invoice'];
        $body = $this->send('post', '/create_order', [
            'invoice' => $invoice,
            'recipient_name' => mb_substr((string) $parcel['recipient_name'], 0, 100),
            'recipient_phone' => (string) $parcel['recipient_phone'],
            'recipient_address' => mb_substr((string) $parcel['recipient_address'], 0, 250),
            // Taka, decimals allowed.
            'cod_amount' => round(((int) $parcel['cod_cents']) / 100, 2),
            'note' => filled($parcel['note'] ?? null) ? mb_substr((string) $parcel['note'], 0, 200) : null,
        ]);
        $consignment = is_array($body['consignment'] ?? null) ? $body['consignment'] : null;
        if ((int) ($body['status'] ?? 0) !== 200 || ! $consignment || blank($consignment['consignment_id'] ?? null)) {
            $reason = self::reason($body);
            Log::warning('Steadfast refused a booking.', ['invoice' => $invoice, 'status' => $body['status'] ?? null, 'reason' => $reason]);
            if (self::duplicate($reason)) {
                throw new CourierException(__('Steadfast already has a parcel for order :number. An earlier attempt may have booked it: check the Steadfast panel before trying again.',
                    ['number' => $invoice]));
            }

            throw new CourierException(__(':courier refused the booking: :reason', ['courier' => 'Steadfast', 'reason' => rtrim($reason, '.')]));
        }

        return new BookingResult(
            (string) $consignment['consignment_id'],
            (string) ($consignment['tracking_code'] ?? $consignment['consignment_id']),
            (string) ($consignment['status'] ?? 'in_review'),
        );
    }

    public function status(Shipment $shipment): StatusResult
    {
        $body = $this->send('get', '/status_by_cid/'.rawurlencode((string) $shipment->courier_consignment_id));
        $raw = $body['delivery_status'] ?? null;
        if ((int) ($body['status'] ?? 0) !== 200 || ! is_string($raw) || $raw === '') {
            Log::warning('Steadfast refused a status check.', ['shipment' => $shipment->number, 'status' => $body['status'] ?? null]);

            throw new CourierException(__(':courier did not give the parcel\'s status: :reason', ['courier' => 'Steadfast', 'reason' => rtrim(self::reason($body), '.')]));
        }

        return $this->result($raw);
    }

    public function balanceCents(): ?int
    {
        $body = $this->send('get', '/get_balance');
        if ((int) ($body['status'] ?? 0) !== 200 || ! is_numeric($body['current_balance'] ?? null)) {
            throw new CourierException(__(':courier did not give the balance.', ['courier' => 'Steadfast']));
        }

        return Pricing::toCents((string) $body['current_balance']);
    }

    public function normalise(string $raw): string
    {
        return self::STATUS_MAP[strtolower(trim($raw))] ?? 'in_transit';
    }

    public function webhookConfigured(): bool
    {
        return filled($this->config('webhook_token'));
    }

    public function authorizeWebhook(Request $request): bool
    {
        $token = (string) $request->bearerToken();

        return $this->webhookConfigured() && $token !== '' && hash_equals((string) $this->config('webhook_token'), $token);
    }

    public function parseWebhook(array $payload): ?array
    {
        $consignment = $payload['consignment_id'] ?? null;
        if (! is_scalar($consignment) || (string) $consignment === '') {
            return null;
        }
        $message = is_string($payload['tracking_message'] ?? null) && trim($payload['tracking_message']) !== '' ? mb_substr(trim($payload['tracking_message']), 0, 500) : null;
        $type = strtolower((string) ($payload['notification_type'] ?? ''));
        $raw = is_string($payload['status'] ?? null) ? trim($payload['status']) : '';

        // A tracking update carries only a message: the status stays.
        if ($type === 'tracking_update' || $raw === '') {
            return $message ? [(string) $consignment, new StatusResult(null, 'in_transit', message: $message)] : null;
        }
        $result = $this->result($raw, $message);
        $done = in_array($result->deliveryStatus, ['delivered', 'partly_delivered'], true);

        return [(string) $consignment, new StatusResult(
            $result->courierStatus,
            $result->deliveryStatus,
            // On a delivered parcel, cod_amount is the cash Steadfast collected.
            $done && is_numeric($payload['cod_amount'] ?? null) ? max(0, Pricing::toCents((string) $payload['cod_amount'])) : null,
            is_numeric($payload['delivery_charge'] ?? null) ? max(0, Pricing::toCents((string) $payload['delivery_charge'])) : null,
            $result->message,
        )];
    }

    private function result(string $raw, ?string $message = null): StatusResult
    {
        $status = $this->normalise($raw);
        // Steadfast's "unknown": its staff have to look at the parcel.
        if ($message === null && str_starts_with(strtolower($raw), 'unknown')) {
            $message = __('The courier needs to check this parcel.');
        }

        return new StatusResult(mb_substr($raw, 0, 60), $status, message: $message);
    }

    /** Steadfast's first error, or its message. */
    private static function reason(array $body): string
    {
        foreach ((array) ($body['errors'] ?? []) as $errors) {
            $first = is_array($errors) ? reset($errors) : $errors;
            if (is_string($first) && $first !== '') {
                return mb_substr($first, 0, 200);
            }
        }

        return is_string($body['message'] ?? null) && $body['message'] !== '' ? mb_substr($body['message'], 0, 200) : 'no reason given';
    }

    /** "The invoice has already been taken." and the like: a retried booking. */
    private static function duplicate(string $reason): bool
    {
        return (bool) preg_match('/invoice/i', $reason) && (bool) preg_match('/taken|already|exist|duplicate/i', $reason);
    }

    private function config(string $key): mixed
    {
        return config("buynest.couriers.steadfast.{$key}");
    }

    /** Steadfast's JSON answer (also for its 4xx answers, which carry the reason). */
    private function send(string $method, string $path, array $body = []): array
    {
        if (! $this->configured()) {
            throw new CourierException(__('Set up :courier first (Settings → Couriers).', ['courier' => 'Steadfast']));
        }
        $url = $this->config('api_url').$path;

        try {
            $request = Http::withHeaders(['Api-Key' => (string) $this->config('api_key'), 'Secret-Key' => (string) $this->config('secret_key')])
                ->acceptJson()->asJson()
                ->connectTimeout((int) config('buynest.couriers.connect_timeout_seconds', 5))
                ->timeout((int) config('buynest.couriers.timeout_seconds', 20));
            /** @var Response $response */
            $response = $method === 'get' ? $request->get($url) : $request->post($url, $body);
        } catch (ConnectionException) {
            Log::warning('Steadfast could not be reached.', ['path' => $path]);
            throw new CourierException(__(':courier could not be reached. Please try again in a moment.', ['courier' => 'Steadfast']), unreachable: true);
        } catch (Throwable $e) {
            Log::error('Steadfast request failed before an answer.', ['path' => $path, 'exception' => $e::class]);
            throw new CourierException(__(':courier could not be reached. Please try again in a moment.', ['courier' => 'Steadfast']), unreachable: true);
        }

        $json = $response->json();
        if ($response->status() === 401 || $response->status() === 403) {
            Log::warning('Steadfast refused the API keys.', ['path' => $path, 'status' => $response->status()]);
            throw new CourierException(__(':courier refused the API keys: check them in backend/.env.', ['courier' => 'Steadfast']));
        }
        if ($response->serverError() || ! is_array($json)) {
            Log::warning('Steadfast answered with an error.', ['path' => $path, 'status' => $response->status()]);
            throw new CourierException(__(':courier is having trouble right now. Please try again in a moment.', ['courier' => 'Steadfast']), unreachable: true);
        }

        // A 4xx answer: its body says why (validation errors, a duplicate invoice).
        return $response->successful() ? $json : ['status' => $json['status'] ?? $response->status(), ...$json];
    }
}
