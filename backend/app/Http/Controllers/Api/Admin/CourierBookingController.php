<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminShipmentResource;
use App\Models\Order;
use App\Models\Shipment;
use App\Services\Audit;
use App\Services\Couriers\CourierException;
use App\Services\Couriers\Couriers;
use App\Services\Couriers\PathaoGateway;
use App\Services\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Phase 18: courier bookings in the admin (docs/backend/PHASE18_CONTRACT.md §1):
 * Settings → Couriers, Pathao's places, the booking dialog, bulk Steadfast
 * bookings, and "Refresh status". The couriers' webhooks are
 * Api\V1\CourierWebhookController.
 */
class CourierBookingController extends Controller
{
    public function __construct(private Couriers $couriers) {}

    /**
     * GET /api/admin/v1/couriers?balance=1 (orders.view or settings.view)
     * → { data: [{ key, label, configured, mode, balance, webhook_url }], settings: {...} }
     * Never a credential; balance only with ?balance=1 (cached 5 minutes).
     */
    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->couriers->summary($request->boolean('balance')), 'settings' => $this->couriers->settings()]);
    }

    /**
     * PUT /api/admin/v1/couriers/settings (settings.edit) { courier_default?, courier_auto_sync?,
     * courier_note_template?, courier_pathao_item_type?, courier_pathao_delivery_type? } → { data: settings }
     */
    public function updateSettings(Request $request, Settings $settings, Audit $audit): JsonResponse
    {
        $data = $request->validate([
            'courier_default' => ['sometimes', 'nullable', Rule::in(array_keys(Couriers::GATEWAYS))],
            'courier_auto_sync' => ['sometimes', 'boolean'],
            'courier_note_template' => ['sometimes', 'nullable', 'string', 'max:'.Couriers::NOTE_MAX],
            'courier_pathao_item_type' => ['sometimes', Rule::in(array_keys(PathaoGateway::ITEM_TYPES))],
            'courier_pathao_delivery_type' => ['sometimes', Rule::in(array_keys(PathaoGateway::DELIVERY_TYPES))],
        ], [
            'courier_default.in' => 'Choose Steadfast, Pathao, or no default courier.',
            'courier_pathao_item_type.in' => 'Choose parcel or document.',
            'courier_pathao_delivery_type.in' => 'Choose normal or on demand delivery.',
        ]);
        if (array_key_exists('courier_auto_sync', $data)) {
            $data['courier_auto_sync'] = filter_var($data['courier_auto_sync'], FILTER_VALIDATE_BOOLEAN);
        }
        if (array_key_exists('courier_note_template', $data)) {
            $data['courier_note_template'] = filled($data['courier_note_template']) ? trim($data['courier_note_template']) : null;
        }

        DB::transaction(function () use ($data, $settings, $audit) {
            $before = $this->couriers->settings();
            $settings->put($data);
            if ($diff = Audit::diff(array_intersect_key($before, $data), $data)) {
                $audit->record('settings.updated', 'Courier settings changed: '.implode(', ', array_keys($diff['after'])).'.', 'settings', null, $diff);
            }
        });

        return response()->json(['data' => $this->couriers->settings()]);
    }

    /** GET /api/admin/v1/couriers/pathao/cities (shipments.create) → { data: [{ id, name }] } */
    public function cities(): JsonResponse
    {
        return $this->places(fn (PathaoGateway $pathao) => $pathao->cities());
    }

    /** GET /api/admin/v1/couriers/pathao/cities/{city}/zones → { data: [{ id, name }] } */
    public function zones(int $city): JsonResponse
    {
        return $this->places(fn (PathaoGateway $pathao) => $pathao->zones($city));
    }

    /** GET /api/admin/v1/couriers/pathao/zones/{zone}/areas → { data: [{ id, name, home_delivery_available, pickup_available }] } */
    public function areas(int $zone): JsonResponse
    {
        return $this->places(fn (PathaoGateway $pathao) => $pathao->areas($zone));
    }

    /** 422 when Pathao isn't set up, 502 { message } when it can't be reached (or refuses). */
    private function places(callable $list): JsonResponse
    {
        $pathao = $this->couriers->gateway('pathao');
        if (! $pathao instanceof PathaoGateway || ! $pathao->configured()) {
            throw ValidationException::withMessages(['courier' => __('Set up :courier first (Settings → Couriers).', ['courier' => 'Pathao'])]);
        }

        try {
            return response()->json(['data' => $list($pathao)]);
        } catch (CourierException $e) {
            return response()->json(['message' => $e->getMessage()], 502);
        }
    }

    /**
     * GET /api/admin/v1/orders/{number}/courier-booking (shipments.create) → { data: { courier_default,
     * couriers, cod_amount, weight_kg, note, phone, address_line, pathao_match, problem, awaits_confirmation } }
     */
    public function defaults(string $number): JsonResponse
    {
        $order = $this->order($number);

        return $order ? response()->json(['data' => $this->couriers->defaults($order)]) : $this->notFound();
    }

    /**
     * POST /api/admin/v1/orders/{number}/courier-booking (shipments.create) { courier, cod_amount?, weight_kg?,
     * note?, notify_customer?, confirmation_override?, pathao: { city_id, zone_id, area_id?, delivery_type?, item_type? } }
     * → 201 { data: AdminShipmentResource }; 422 with the courier's own reason when it refuses (nothing saved).
     */
    public function store(Request $request, string $number): JsonResponse
    {
        $data = $this->validated($request);
        $order = $this->order($number);
        if (! $order) {
            return $this->notFound();
        }
        $shipment = $this->couriers->book($order, $request->user(), $data['courier'], $data);

        return response()->json(['data' => (new AdminShipmentResource($shipment->load(['order.items', 'admin', 'events'])))->resolve()], 201);
    }

    /**
     * POST /api/admin/v1/orders/courier-bookings (shipments.create) { courier: "steadfast", numbers: [1..50] }
     * → { data: { booked: [{ number, consignment_id, tracking_code }], failed: [{ number, message }] } }
     * Steadfast only (Pathao needs a place per order). Each order is its own
     * transaction: one failure doesn't stop the rest.
     */
    public function bulk(Request $request): JsonResponse
    {
        $data = $request->validate([
            'courier' => ['required', Rule::in(['steadfast'])],
            'numbers' => ['required', 'array', 'min:1', 'max:50'],
            'numbers.*' => ['required', 'string', 'max:20', 'distinct:ignore_case'],
            'notify_customer' => ['nullable', 'boolean'],
        ], [
            'courier.in' => 'Bulk booking works with Steadfast only: book Pathao parcels one by one (they need a place).',
            'numbers.required' => 'Select at least one order.',
            'numbers.max' => 'Select at most 50 orders at a time.',
        ]);

        $booked = [];
        $failed = [];
        foreach (array_values(array_unique(array_map(fn ($n) => strtoupper(trim($n)), $data['numbers']))) as $number) {
            $order = $this->order($number);
            if (! $order) {
                $failed[] = ['number' => $number, 'message' => 'Order not found.'];

                continue;
            }

            try {
                $shipment = $this->couriers->book($order, $request->user(), $data['courier'], ['notify_customer' => $data['notify_customer'] ?? true]);
                $booked[] = ['number' => $number, 'consignment_id' => $shipment->courier_consignment_id, 'tracking_code' => $shipment->tracking_number];
            } catch (ValidationException $e) {
                $failed[] = ['number' => $number, 'message' => collect($e->errors())->flatten()->first() ?? $e->getMessage()];
            }
        }

        return response()->json(['data' => ['booked' => $booked, 'failed' => $failed]]);
    }

    /**
     * POST /api/admin/v1/shipments/{number}/sync (shipments.create): asks the courier now
     * → { data: AdminShipmentResource }; 422 for a manual shipment or a refusal; 502 when unreachable.
     */
    public function sync(string $number): JsonResponse
    {
        $shipment = Shipment::where('number', strtoupper(trim($number)))->first();
        if (! $shipment) {
            return response()->json(['message' => 'Shipment not found.'], 404);
        }
        if (! $shipment->booked_via_api || ! $this->couriers->find($shipment->carrier)) {
            throw ValidationException::withMessages(['shipment' => __('Only parcels booked with a courier can be refreshed.')]);
        }

        try {
            $this->couriers->sync($shipment, 'sync');
        } catch (CourierException $e) {
            if ($e->unreachable) {
                return response()->json(['message' => $e->getMessage()], 502);
            }
            throw ValidationException::withMessages(['courier' => $e->getMessage()]);
        }

        return response()->json(['data' => (new AdminShipmentResource($shipment->fresh()->load(['order.items', 'admin', 'events'])))->resolve()]);
    }

    private function validated(Request $request): array
    {
        return $request->validate([
            'courier' => ['required', 'string', Rule::in(array_keys(Couriers::GATEWAYS))],
            'cod_amount' => ['nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:100000000'],
            'weight_kg' => ['nullable', 'numeric', 'min:0.01', 'max:100'],
            'note' => ['nullable', 'string', 'max:'.Couriers::NOTE_MAX],
            'notify_customer' => ['nullable', 'boolean'],
            'confirmation_override' => ['nullable', 'string', 'min:3', 'max:500'],
            'pathao' => ['nullable', 'array'],
            'pathao.city_id' => ['nullable', 'integer', 'min:1'],
            'pathao.zone_id' => ['nullable', 'integer', 'min:1'],
            'pathao.area_id' => ['nullable', 'integer', 'min:1'],
            'pathao.delivery_type' => ['nullable', Rule::in(array_keys(PathaoGateway::DELIVERY_TYPES))],
            'pathao.item_type' => ['nullable', Rule::in(array_keys(PathaoGateway::ITEM_TYPES))],
        ], [
            'courier.required' => __('Choose a courier.'),
            'courier.in' => __('Choose a courier.'),
        ]);
    }

    private function order(string $number): ?Order
    {
        return Order::where('number', strtoupper(trim($number)))->with(['items.product', 'items.variant'])->first();
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Order not found.'], 404);
    }
}
