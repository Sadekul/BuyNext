<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminShipmentResource;
use App\Http\Resources\ShipmentResource;
use App\Mail\ShipmentMail;
use App\Models\Order;
use App\Models\Shipment;
use App\Services\OrderDocuments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rule;
use Throwable;

/** Shipping an order: carrier and tracking number, and the "on its way" email. */
class ShipmentController extends Controller
{
    /** POST /api/admin/v1/orders/{number}/shipments { carrier, tracking_number?, note?, notify_customer? } → 201 */
    public function store(Request $request, string $number, OrderDocuments $documents): JsonResponse
    {
        $data = $request->validate([
            'carrier' => ['required', Rule::in(array_keys(Shipment::CARRIERS))],
            'tracking_number' => ['nullable', 'string', 'max:60', 'regex:/^[A-Za-z0-9 -]+$/'],
            'note' => ['nullable', 'string', 'max:1000'],
            'notify_customer' => ['nullable', 'boolean'],
            'confirmation_override' => ['nullable', 'string', 'min:3', 'max:500'], // phase 14: ship an unconfirmed COD order anyway (reason)
        ], [
            'carrier.required' => 'Choose a carrier.',
            // Phase 18: the Bangladeshi couriers too (Steadfast and Pathao can also be booked through their API).
            'carrier.in' => 'Choose a carrier: DHL, FedEx, UPS, USPS, Steadfast, Pathao, RedX, Paperfly, Sundarban Courier, or other.',
            'tracking_number.regex' => 'A tracking number has only letters, digits, spaces, and dashes.',
        ]);
        if (! Order::where('number', strtoupper($number))->exists()) {
            return response()->json(['message' => 'Order not found.'], 404);
        }
        $notify = $data['notify_customer'] ?? true;
        $tracking = filled($data['tracking_number'] ?? null) ? strtoupper(trim($data['tracking_number'])) : null;

        $shipment = DB::transaction(function () use ($number, $data, $tracking, $notify, $request, $documents) {
            $order = Order::where('number', strtoupper($number))->lockForUpdate()->firstOrFail();

            return $documents->ship($order, $request->user(), $data['carrier'], $tracking, $data['note'] ?? null, $notify,
                confirmationOverride: $data['confirmation_override'] ?? null);
        });

        $shipment->load(['order', 'admin']);
        if ($notify) {
            try {
                Mail::to($shipment->order->email)->send(new ShipmentMail($shipment));
            } catch (Throwable $e) {
                report($e);
            }
        }

        return (new ShipmentResource($shipment))->response()->setStatusCode(201);
    }

    /**
     * GET /api/admin/v1/shipments?carrier&delivery_status&from&to&search&page&per_page - newest first.
     * search: shipment number, tracking number, or order number. from/to: the shipment date (inclusive).
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'carrier' => ['nullable', Rule::in(array_keys(Shipment::CARRIERS))],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'search' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'delivery_status' => ['nullable', Rule::in(Shipment::DELIVERY_STATUSES)], // phase 18
        ]);

        $shipments = Shipment::with(['order.items', 'admin', 'events'])
            ->when($data['carrier'] ?? null, fn ($query, $carrier) => $query->where('carrier', $carrier))
            ->when($data['delivery_status'] ?? null, fn ($query, $status) => $query->where('delivery_status', $status))
            ->when($data['from'] ?? null, fn ($query, $from) => $query->where('created_at', '>=', $from.' 00:00:00'))
            ->when($data['to'] ?? null, fn ($query, $to) => $query->where('created_at', '<=', $to.' 23:59:59'))
            ->when($data['search'] ?? null, function ($query, $search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $query->where(fn ($q) => $q->where('number', 'like', $like)->orWhere('tracking_number', 'like', $like)
                    ->orWhereHas('order', fn ($o) => $o->where('number', 'like', $like)));
            })
            ->latest('id')
            ->paginate($data['per_page'] ?? 20)
            ->withQueryString();

        return AdminShipmentResource::collection($shipments);
    }

    /** GET /api/admin/v1/shipments/{number} - with its order summary and the items shipped. */
    public function show(string $number): JsonResponse
    {
        $shipment = Shipment::with(['order.items', 'admin', 'events'])->where('number', strtoupper($number))->first();

        return $shipment
            ? response()->json(['data' => (new AdminShipmentResource($shipment))->detail()->resolve()])
            : response()->json(['message' => 'Shipment not found.'], 404);
    }
}
