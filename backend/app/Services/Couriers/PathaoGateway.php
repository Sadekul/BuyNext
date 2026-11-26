<?php

namespace App\Services\Couriers;

use App\Models\Shipment;
use App\Services\Pricing;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Phase 18: the only class that talks to Pathao Courier (merchant "Aladdin"
 * API). No SDK: Laravel's HTTP client (tests use Http::fake()).
 *
 * The wire format below is from Pathao's published merchant API and
 * community SDKs; it has NOT yet been verified against a real Pathao
 * account. Verify it with sandbox credentials before going live
 * (docs/BANGLADESH.md → Couriers); a correction is a change to this file only.
 *
 * - Sign-in: OAuth password grant, POST /aladdin/api/v1/issue-token. The
 *   access token is cached (couriers.pathao.token) until 5 minutes before it
 *   expires; on a 401 it is dropped and the request retried once. Tokens and
 *   credentials are never logged.
 * - Locations (cached 24 h): city-list, cities/{city}/zone-list, zones/{zone}/area-list.
 * - Book: POST /aladdin/api/v1/orders → { code: 200, data: { consignment_id, order_status, delivery_fee } };
 *   validation errors come back as { code: 422, errors: { field: [...] } }.
 * - Status: GET /aladdin/api/v1/orders/{consignment_id}/info → data.order_status (+ order_status_slug).
 * - Webhook: Pathao posts { consignment_id, merchant_order_id, event, order_status,
 *   collected_amount?, delivery_fee?, updated_at } with X-PATHAO-Signature =
 *   PATHAO_WEBHOOK_SECRET, and expects 202 with the header
 *   X-Pathao-Merchant-Webhook-Integration-Secret (its integration check, also
 *   sent as event "webhook_integration").
 * - Base URL: PATHAO_API_URL, else sandbox or live by PATHAO_MODE.
 */
class PathaoGateway implements CourierGateway
{
    public const TOKEN_CACHE_KEY = 'couriers.pathao.token';

    /** Delivery types and item types as Pathao numbers them. */
    public const DELIVERY_TYPES = ['normal' => 48, 'on_demand' => 12];

    public const ITEM_TYPES = ['parcel' => 2, 'document' => 1];

    /** Pathao's statuses (slug, or its text made into one) → ours (anything else: in_transit). */
    public const STATUS_MAP = [
        'pending' => 'booked',
        'pickup_requested' => 'booked',
        'assigned_for_pickup' => 'booked',
        'picked' => 'picked_up',
        'pickup_success' => 'picked_up',
        'at_the_sorting_hub' => 'in_transit',
        'in_transit' => 'in_transit',
        'received_at_last_mile_hub' => 'in_transit',
        'assigned_for_delivery' => 'out_for_delivery',
        'delivered' => 'delivered',
        'partial_delivery' => 'partly_delivered',
        'on_hold' => 'on_hold',
        'delivery_failed' => 'on_hold',
        'pickup_failed' => 'on_hold',
        'return' => 'returned',
        'returned' => 'returned',
        'paid_return' => 'returned',
        'exchange' => 'returned',
        'pickup_cancelled' => 'cancelled',
        'cancelled' => 'cancelled',
    ];

    private const LOCATIONS_TTL = 86400;

    public function key(): string
    {
        return 'pathao';
    }

    public function label(): string
    {
        return 'Pathao';
    }

    public function configured(): bool
    {
        foreach (['client_id', 'client_secret', 'username', 'password', 'store_id'] as $key) {
            if (blank($this->config($key))) {
                return false;
            }
        }

        return true;
    }

    public function mode(): ?string
    {
        return $this->config('mode') === 'live' ? 'live' : 'sandbox';
    }

    /** @return list<array{id: int, name: string}> */
    public function cities(): array
    {
        return Cache::remember('couriers.pathao.cities', self::LOCATIONS_TTL, fn () => array_map(
            fn ($city) => ['id' => (int) $city['city_id'], 'name' => (string) $city['city_name']],
            $this->list('/aladdin/api/v1/city-list', 'city_id'),
        ));
    }

    /** @return list<array{id: int, name: string}> */
    public function zones(int $city): array
    {
        return Cache::remember("couriers.pathao.zones.{$city}", self::LOCATIONS_TTL, fn () => array_map(
            fn ($zone) => ['id' => (int) $zone['zone_id'], 'name' => (string) $zone['zone_name']],
            $this->list("/aladdin/api/v1/cities/{$city}/zone-list", 'zone_id'),
        ));
    }

    /** @return list<array{id: int, name: string, home_delivery_available: bool, pickup_available: bool}> */
    public function areas(int $zone): array
    {
        return Cache::remember("couriers.pathao.areas.{$zone}", self::LOCATIONS_TTL, fn () => array_map(fn ($area) => [
            'id' => (int) $area['area_id'],
            'name' => (string) $area['area_name'],
            'home_delivery_available' => (bool) ($area['home_delivery_available'] ?? true),
            'pickup_available' => (bool) ($area['pickup_available'] ?? true),
        ], $this->list("/aladdin/api/v1/zones/{$zone}/area-list", 'area_id')));
    }

    public function book(array $parcel): BookingResult
    {
        $invoice = (string) $parcel['invoice'];
        $options = (array) ($parcel['pathao'] ?? []);
        $body = array_filter([
            'store_id' => (int) $this->config('store_id'),
            'merchant_order_id' => $invoice,
            'recipient_name' => mb_substr((string) $parcel['recipient_name'], 0, 100),
            'recipient_phone' => (string) $parcel['recipient_phone'],
            'recipient_address' => mb_substr((string) $parcel['recipient_address'], 0, 220),
            'recipient_city' => (int) $options['city_id'],
            'recipient_zone' => (int) $options['zone_id'],
            'recipient_area' => isset($options['area_id']) ? (int) $options['area_id'] : null,
            'delivery_type' => self::DELIVERY_TYPES[$options['delivery_type'] ?? 'normal'] ?? 48,
            'item_type' => self::ITEM_TYPES[$options['item_type'] ?? 'parcel'] ?? 2,
            'special_instruction' => filled($parcel['note'] ?? null) ? mb_substr((string) $parcel['note'], 0, 200) : null,
            'item_quantity' => max(1, (int) ($parcel['item_quantity'] ?? 1)),
            // Kilograms, 0.5–10.
            'item_weight' => round(min(10, max(0.5, ((int) $parcel['weight_grams']) / 1000)), 2),
            // Whole taka: rounded up, so the courier never collects less than due.
            'amount_to_collect' => (int) ceil(((int) $parcel['cod_cents']) / 100),
        ], fn ($value) => $value !== null);

        $answer = $this->authed('post', '/aladdin/api/v1/orders', $body);
        $data = is_array($answer['data'] ?? null) ? $answer['data'] : null;
        if ((int) ($answer['code'] ?? 0) !== 200 || ! $data || blank($data['consignment_id'] ?? null)) {
            $reason = self::reason($answer);
            Log::warning('Pathao refused a booking.', ['invoice' => $invoice, 'code' => $answer['code'] ?? null, 'reason' => $reason]);
            if (preg_match('/merchant.?order/i', $reason) && preg_match('/taken|already|exist|duplicate/i', $reason)) {
                throw new CourierException(__('Pathao already has a parcel for order :number. An earlier attempt may have booked it: check the Pathao panel before trying again.',
                    ['number' => $invoice]));
            }

            throw new CourierException(__(':courier refused the booking: :reason', ['courier' => 'Pathao', 'reason' => rtrim($reason, '.')]));
        }
        $consignment = (string) $data['consignment_id'];

        return new BookingResult($consignment, $consignment, (string) ($data['order_status'] ?? 'Pending'),
            is_numeric($data['delivery_fee'] ?? null) ? Pricing::toCents((string) $data['delivery_fee']) : null);
    }

    public function status(Shipment $shipment): StatusResult
    {
        $answer = $this->authed('get', '/aladdin/api/v1/orders/'.rawurlencode((string) $shipment->courier_consignment_id).'/info');
        $data = is_array($answer['data'] ?? null) ? $answer['data'] : [];
        $raw = $data['order_status_slug'] ?? $data['order_status'] ?? null;
        if ((int) ($answer['code'] ?? 0) !== 200 || ! is_string($raw) || $raw === '') {
            Log::warning('Pathao refused a status check.', ['shipment' => $shipment->number, 'code' => $answer['code'] ?? null]);

            throw new CourierException(__(':courier did not give the parcel\'s status: :reason', ['courier' => 'Pathao', 'reason' => rtrim(self::reason($answer), '.')]));
        }
        $status = $this->normalise($raw);

        return new StatusResult(mb_substr($raw, 0, 60), $status,
            in_array($status, ['delivered', 'partly_delivered'], true) && is_numeric($data['collected_amount'] ?? null) ? Pricing::toCents((string) $data['collected_amount']) : null,
            is_numeric($data['delivery_fee'] ?? null) ? Pricing::toCents((string) $data['delivery_fee']) : null);
    }

    public function balanceCents(): ?int
    {
        return null;
    }

    public function normalise(string $raw): string
    {
        $slug = trim((string) preg_replace('/[^a-z0-9]+/', '_', strtolower(trim($raw))), '_');

        return self::STATUS_MAP[$slug] ?? 'in_transit';
    }

    public function webhookConfigured(): bool
    {
        return filled($this->config('webhook_secret'));
    }

    /** The secret Pathao expects back on every webhook answer. */
    public function webhookSecret(): string
    {
        return (string) $this->config('webhook_secret');
    }

    public function authorizeWebhook(Request $request): bool
    {
        $signature = (string) $request->header('X-PATHAO-Signature');

        return $this->webhookConfigured() && $signature !== '' && hash_equals($this->webhookSecret(), $signature);
    }

    public function parseWebhook(array $payload): ?array
    {
        $consignment = $payload['consignment_id'] ?? null;
        $event = strtolower((string) ($payload['event'] ?? ''));
        if ($event === 'webhook_integration' || ! is_scalar($consignment) || (string) $consignment === '') {
            return null;
        }
        // The status text, else the event name ("order.delivered" → "delivered").
        $raw = is_string($payload['order_status'] ?? null) && trim($payload['order_status']) !== ''
            ? trim($payload['order_status']) : preg_replace('/^order\./', '', $event);
        if ($raw === '' || $raw === null) {
            return null;
        }
        $status = $this->normalise($raw);

        return [(string) $consignment, new StatusResult(mb_substr($raw, 0, 60), $status,
            in_array($status, ['delivered', 'partly_delivered'], true) && is_numeric($payload['collected_amount'] ?? null)
                ? max(0, Pricing::toCents((string) $payload['collected_amount'])) : null,
            is_numeric($payload['delivery_fee'] ?? null) ? max(0, Pricing::toCents((string) $payload['delivery_fee'])) : null)];
    }

    /** A location list (data.data), keeping only rows that have $idKey. */
    private function list(string $path, string $idKey): array
    {
        $answer = $this->authed('get', $path);
        $rows = $answer['data']['data'] ?? null;
        if ((int) ($answer['code'] ?? 0) !== 200 || ! is_array($rows)) {
            Log::warning('Pathao refused a location list.', ['path' => $path, 'code' => $answer['code'] ?? null]);
            throw new CourierException(__(':courier did not give the list of places.', ['courier' => 'Pathao']));
        }

        return array_values(array_filter($rows, fn ($row) => is_array($row) && isset($row[$idKey])));
    }

    /** Pathao's first validation error, or its message. */
    private static function reason(array $answer): string
    {
        foreach ((array) ($answer['errors'] ?? []) as $errors) {
            $first = is_array($errors) ? reset($errors) : $errors;
            if (is_string($first) && $first !== '') {
                return mb_substr($first, 0, 200);
            }
        }

        return is_string($answer['message'] ?? null) && $answer['message'] !== '' ? mb_substr($answer['message'], 0, 200) : 'no reason given';
    }

    private function config(string $key): mixed
    {
        return config("buynest.couriers.pathao.{$key}");
    }

    /** The cached access token, or a new one. */
    private function token(): string
    {
        $token = Cache::get(self::TOKEN_CACHE_KEY);
        if (is_string($token) && $token !== '') {
            return $token;
        }
        $response = $this->send(fn ($request) => $request->post($this->config('api_url').'/aladdin/api/v1/issue-token', [
            'client_id' => (string) $this->config('client_id'),
            'client_secret' => (string) $this->config('client_secret'),
            'username' => (string) $this->config('username'),
            'password' => (string) $this->config('password'),
            'grant_type' => 'password',
        ]), '/aladdin/api/v1/issue-token');
        $body = $response->json();
        if ($response->serverError()) {
            Log::warning('Pathao answered the sign-in with an error.', ['status' => $response->status()]);
            throw new CourierException(__(':courier is having trouble right now. Please try again in a moment.', ['courier' => 'Pathao']), unreachable: true);
        }
        if (! $response->successful() || ! is_string($body['access_token'] ?? null) || $body['access_token'] === '') {
            Log::warning('Pathao refused the sign-in.', ['status' => $response->status()]);
            throw new CourierException(__(':courier refused the sign-in: check the PATHAO_* settings in backend/.env.', ['courier' => 'Pathao']));
        }
        Cache::put(self::TOKEN_CACHE_KEY, $body['access_token'], max(60, (int) ($body['expires_in'] ?? 3600) - 300));

        return $body['access_token'];
    }

    /** A signed-in request → Pathao's JSON answer (also for its 4xx answers, which carry the reason). */
    private function authed(string $method, string $path, array $body = [], bool $retry = true): array
    {
        if (! $this->configured()) {
            throw new CourierException(__('Set up :courier first (Settings → Couriers).', ['courier' => 'Pathao']));
        }
        $url = $this->config('api_url').$path;
        $token = $this->token();
        $response = $this->send(fn ($request) => $method === 'get' ? $request->withToken($token)->get($url) : $request->withToken($token)->post($url, $body), $path);

        if ($response->status() === 401) {
            Cache::forget(self::TOKEN_CACHE_KEY);
            if ($retry) {
                return $this->authed($method, $path, $body, false);
            }
            Log::warning('Pathao refused the access token twice.', ['path' => $path]);
            throw new CourierException(__(':courier refused the sign-in: check the PATHAO_* settings in backend/.env.', ['courier' => 'Pathao']));
        }
        $json = $response->json();
        if ($response->serverError() || ! is_array($json)) {
            Log::warning('Pathao answered with an error.', ['path' => $path, 'status' => $response->status()]);
            throw new CourierException(__(':courier is having trouble right now. Please try again in a moment.', ['courier' => 'Pathao']), unreachable: true);
        }

        return $response->successful() ? $json : ['code' => $json['code'] ?? $response->status(), ...$json];
    }

    /** Sends with the shared timeouts; connection problems → CourierException (unreachable). */
    private function send(callable $call, string $path): Response
    {
        try {
            return $call(Http::acceptJson()->asJson()
                ->connectTimeout((int) config('buynest.couriers.connect_timeout_seconds', 5))
                ->timeout((int) config('buynest.couriers.timeout_seconds', 20)));
        } catch (ConnectionException) {
            Log::warning('Pathao could not be reached.', ['path' => $path]);
        } catch (Throwable $e) {
            Log::error('Pathao request failed before an answer.', ['path' => $path, 'exception' => $e::class]);
        }

        throw new CourierException(__(':courier could not be reached. Please try again in a moment.', ['courier' => 'Pathao']), unreachable: true);
    }
}
