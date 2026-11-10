<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\ShipmentResource;
use App\Mail\ShipmentMail;
use App\Models\Order;
use App\Models\Shipment;
use App\Services\OrderDocuments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
        ], [
            'carrier.required' => 'Choose a carrier.',
            'carrier.in' => 'Choose a carrier: DHL, FedEx, UPS, USPS, or other.',
            'tracking_number.regex' => 'A tracking number has only letters, digits, spaces, and dashes.',
        ]);
        if (! Order::where('number', strtoupper($number))->exists()) {
            return response()->json(['message' => 'Order not found.'], 404);
        }
        $notify = $data['notify_customer'] ?? true;
        $tracking = filled($data['tracking_number'] ?? null) ? strtoupper(trim($data['tracking_number'])) : null;

        $shipment = DB::transaction(function () use ($number, $data, $tracking, $notify, $request, $documents) {
            $order = Order::where('number', strtoupper($number))->lockForUpdate()->firstOrFail();

            return $documents->ship($order, $request->user(), $data['carrier'], $tracking, $data['note'] ?? null, $notify);
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
}
