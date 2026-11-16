<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Mail\InvoiceMail;
use App\Mail\OrderStatusMail;
use App\Mail\ShipmentMail;
use App\Models\Order;
use App\Models\Shipment;
use App\Services\OrderDocuments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Mass actions on the order grid (Magento's order grid actions). Unlike the
 * product mass actions, each order is handled on its own (its own
 * transaction, its row locked): one order that can't be invoiced, shipped,
 * or cancelled is listed in `skipped` with the reason, and the others go on.
 */
class OrderBulkController extends Controller
{
    /** The permission each action needs (the route itself needs orders.view). */
    private const PERMISSIONS = ['invoice' => 'invoices.create', 'ship' => 'shipments.create', 'cancel' => 'orders.edit'];

    /**
     * POST /api/admin/v1/orders/bulk { numbers: [..1–100], action: invoice|ship|cancel, carrier? (ship), notify_customer? }
     * → { data: { done: [numbers], skipped: [{ number, reason }] } }
     */
    public function __invoke(Request $request, OrderDocuments $documents): JsonResponse
    {
        $data = $request->validate([
            'numbers' => ['required', 'array', 'min:1', 'max:100'],
            'numbers.*' => ['required', 'string', 'max:20', 'distinct:ignore_case'],
            'action' => ['required', Rule::in(array_keys(self::PERMISSIONS))],
            'carrier' => ['required_if:action,ship', 'nullable', Rule::in(array_keys(Shipment::CARRIERS))],
            'notify_customer' => ['nullable', 'boolean'],
        ], [
            'numbers.required' => 'Select at least one order.',
            'numbers.max' => 'Select at most 100 orders at a time.',
            'action.in' => 'Choose invoice, ship, or cancel.',
            'carrier.required_if' => 'Choose a carrier.',
            'carrier.in' => 'Choose a carrier: DHL, FedEx, UPS, USPS, or other.',
        ]);

        $admin = $request->user();
        $permission = self::PERMISSIONS[$data['action']];
        if (! $admin->hasPermission($permission)) {
            return response()->json(['message' => 'Your role doesn\'t allow this.', 'code' => 'permission_denied', 'permission' => $permission], 403);
        }
        $notify = (bool) ($data['notify_customer'] ?? true);

        $done = [];
        $skipped = [];
        foreach ($data['numbers'] as $number) {
            $number = strtoupper(trim($number));
            try {
                $document = DB::transaction(function () use ($number, $data, $admin, $documents, $notify) {
                    $order = Order::where('number', $number)->lockForUpdate()->first();
                    if (! $order) {
                        throw ValidationException::withMessages(['order' => 'Order not found.']);
                    }

                    return match ($data['action']) {
                        'invoice' => $documents->invoice($order, $admin, null, $notify),
                        'ship' => $documents->ship($order, $admin, $data['carrier'], null, null, $notify),
                        'cancel' => tap($order, fn () => $documents->cancel($order, $admin, null, $notify)),
                    };
                });
            } catch (ValidationException $e) {
                $skipped[] = ['number' => $number, 'reason' => collect($e->errors())->flatten()->first()];

                continue;
            }
            $done[] = $number;
            if ($notify) {
                $this->email($data['action'], $document);
            }
        }

        return response()->json(['data' => ['done' => $done, 'skipped' => $skipped]]);
    }

    /** After each order's commit: a failed email changes nothing. */
    private function email(string $action, mixed $document): void
    {
        try {
            match ($action) {
                'invoice' => Mail::to($document->order->email)->send(new InvoiceMail($document->load(['admin', 'order.items', 'order.invoices', 'order.creditMemos']))),
                'ship' => Mail::to($document->order->email)->send(new ShipmentMail($document->load(['order', 'admin']))),
                'cancel' => Mail::to($document->email)->send(new OrderStatusMail($document->refresh())),
            };
        } catch (Throwable $e) {
            report($e);
        }
    }
}
