<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminOrderResource;
use App\Mail\OrderStatusMail;
use App\Models\Order;
use App\Models\Shipment;
use App\Services\Audit;
use App\Services\OrderDocuments;
use App\Services\Payments\OnlinePayments;
use App\Services\Payments\SslCommerzPayments;
use App\Services\Pricing;
use App\Services\Settings;
use App\Support\Csv;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

/** Orders, as shop staff manage them: list, detail, and moving them along (deliver, cancel, notes; ship and mark paid as shortcuts). */
class OrderController extends Controller
{
    /** GET /api/admin/v1/orders?search&status&payment_status&source&customer_id&delivery_status&page&per_page - newest first. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $this->filters($request);
        $data += $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);

        $orders = $this->filtered($data)->with(['items', 'customer', 'createdBy', ...Order::DOCUMENTS])
            ->latest('id')
            ->paginate($data['per_page'] ?? 20)
            ->withQueryString();

        return AdminOrderResource::collection($orders);
    }

    /** GET /api/admin/v1/orders/export.csv - the grid's filters, every matching order. */
    public function export(Request $request): Response
    {
        $orders = $this->filtered($this->filters($request))->with(['items', 'customer', 'invoices', 'creditMemos'])->latest('id')->get();

        return Csv::download('orders-'.now()->format('Y-m-d').'.csv', [
            'number', 'placed_at', 'status', 'payment_status', 'source', 'customer_name', 'email', 'phone', 'customer_group', 'items',
            'subtotal', 'discount', 'shipping', 'tax', 'total', 'paid', 'refunded', 'payment_method', 'shipping_method', 'coupon_code',
            'ship_to_city', 'ship_to_country', 'currency', // phase 12: the currency of the money columns
        ], $orders->map(fn (Order $order) => [
            $order->number, $order->placed_at?->toIso8601ZuluString(), $order->status, $order->payment_status, $order->source,
            trim(($order->shipping_address['first_name'] ?? '').' '.($order->shipping_address['last_name'] ?? '')),
            $order->email, $order->phone, $order->customer_group, $order->itemCount(),
            $order->subtotal, $order->discount_total, $order->shipping_total, $order->tax_total, $order->grand_total,
            Pricing::format($order->paidCents()), Pricing::format($order->refundedCents()), $order->payment_method, $order->shipping_method,
            $order->coupon_code, $order->shipping_address['city'] ?? null, $order->shipping_address['country'] ?? null, $order->currencyCode(),
        ]));
    }

    /**
     * GET /api/admin/v1/orders/{number}/packing-slip - what goes in the parcel,
     * for the admin's print page: items, quantities, variant labels, ship-to
     * address. No prices.
     */
    public function packingSlip(string $number, Settings $settings): JsonResponse
    {
        $order = Order::where('number', strtoupper($number))->with(['items', 'shipments'])->first();
        if (! $order) {
            return $this->notFound();
        }

        return response()->json(['data' => [
            'order_number' => $order->number,
            'placed_at' => $order->placed_at?->toIso8601ZuluString(),
            'status' => $order->status,
            'email' => $order->email,
            'phone' => $order->phone,
            'shipping_method' => ['id' => $order->shipping_method, 'label' => $order->shipping_label],
            'ship_to' => $order->shipping_address,
            'items' => $order->items->map(fn ($item) => [
                'order_item_id' => $item->id,
                'sku' => $item->sku,
                'name' => $item->name,
                'variant_label' => $item->variant_label,
                'quantity' => $item->quantity,
            ])->values(),
            'item_count' => $order->itemCount(),
            'shipments' => $order->shipments->map(fn ($shipment) => [
                'number' => $shipment->number,
                'carrier' => $shipment->carrier,
                'carrier_label' => $shipment->carrierLabel(),
                'tracking_number' => $shipment->tracking_number,
                'created_at' => $shipment->created_at?->toIso8601ZuluString(),
            ])->values(),
            'store' => [
                'name' => $settings->get('store_name'),
                'address' => $settings->get('address'),
                'support_email' => $settings->get('support_email'),
                'support_phone' => $settings->get('support_phone'),
            ],
        ]]);
    }

    /** GET /api/admin/v1/orders/{number} - with the full history (who did what). */
    public function show(string $number): AdminOrderResource|JsonResponse
    {
        $order = $this->find($number);

        return $order ? new AdminOrderResource($order) : $this->notFound();
    }

    /**
     * PATCH /api/admin/v1/orders/{number} { status?, payment_status?: "paid", note?, notify_customer? }
     * Only the allowed transitions (Order::TRANSITIONS). Cancelling puts the
     * stock back and gives the coupon use back, and is refused once the order
     * has an invoice (refund it instead). Phase 2 shortcuts, kept so older
     * clients work: payment_status "paid" creates the full invoice, and
     * status "shipped" creates a shipment without tracking (OrderDocuments).
     */
    public function update(Request $request, string $number, OrderDocuments $documents, Audit $audit): AdminOrderResource|JsonResponse
    {
        $data = $request->validate([
            'status' => ['nullable', Rule::in(Order::STATUSES)],
            'payment_status' => ['nullable', 'in:paid'],
            'note' => ['nullable', 'string', 'max:1000'],
            'notify_customer' => ['nullable', 'boolean'],
            // Phase 14: cash collected on delivery (COD), and shipping an unconfirmed COD order anyway.
            'collected_amount' => ['nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:100000000'],
            'collection_note' => ['nullable', 'string', 'max:1000'],
            'confirmation_override' => ['nullable', 'string', 'min:3', 'max:500'],
        ], [
            'status.in' => 'Choose a valid order status.',
            'payment_status.in' => 'An order can only be marked paid.',
        ]);

        if (! Order::where('number', strtoupper($number))->exists()) {
            return $this->notFound();
        }
        $notify = $data['notify_customer'] ?? true;
        $note = $data['note'] ?? null;

        [$order, $statusChanged] = DB::transaction(function () use ($number, $data, $note, $notify, $request, $documents, $audit) {
            // Lock the order: two staff members clicking at once can't both cancel (and restock twice).
            $order = Order::where('number', strtoupper($number))->lockForUpdate()->firstOrFail();
            $admin = $request->user();
            $from = $order->status;
            $to = $data['status'] ?? $from;
            $markPaid = ($data['payment_status'] ?? null) === 'paid' && ! $order->invoices()->exists();

            if ($to !== $from && ! $order->canMoveTo($to)) {
                throw ValidationException::withMessages(['status' => $this->transitionError($from, $to)]);
            }
            if ($markPaid && ($to === 'cancelled' || $from === 'cancelled')) {
                throw ValidationException::withMessages(['payment_status' => 'A cancelled order can\'t be marked paid.']);
            }
            if ($to === 'cancelled' && $from !== 'cancelled' && $order->invoices()->exists()) {
                throw ValidationException::withMessages(['status' => 'This order has been invoiced (paid), so it can\'t be cancelled. Create a refund (credit memo) instead.']);
            }
            $collect = isset($data['collected_amount']);
            if ($to === $from && ! $markPaid && blank($note) && ! $collect) {
                throw ValidationException::withMessages(['status' => 'Choose a new status, mark the order paid, or add a note.']);
            }

            // Shortcut: "mark paid" = the full invoice (no email: phase 2 didn't send one either).
            // It also moves pending_payment to processing.
            if ($markPaid) {
                $documents->invoice($order, $admin, $to === $from ? $note : null, false, 'payment_status');
                if ($to === $from) {
                    return [$order, false];
                }
                $from = $order->status;
                if ($to === $from) { // asked for processing, and the invoice already did that
                    return [$order, false];
                }
            }

            // The customer hears about shipping, delivery, and cancellation (OrderStatusMail).
            $emailed = $notify && $to !== $from && in_array($to, OrderStatusMail::STATUSES, true);

            // Phase 14: the cash collected on delivery (with "delivered", or on a shipped/delivered COD order).
            if ($collect) {
                if (! in_array($to, ['shipped', 'delivered'], true) || ! in_array($from, ['shipped', 'delivered'], true)) {
                    throw ValidationException::withMessages(['collected_amount' => 'Record the cash collected when the order is delivered.']);
                }
                $documents->collect($order, $admin, Pricing::toCents((string) $data['collected_amount']), $data['collection_note'] ?? null);
                if ($to === $from && blank($note)) {
                    return [$order, false];
                }
            }

            // Shortcut: "shipped" = a shipment without tracking (same rules as the shipment endpoint).
            if ($to === 'shipped' && $from !== 'shipped') {
                $documents->ship($order, $admin, 'other', null, $note, $emailed, historyNote: $note, errorKey: 'status',
                    confirmationOverride: $data['confirmation_override'] ?? null);

                return [$order, $emailed];
            }

            // Only on the way INTO cancelled: a note on a cancelled order must not restock twice.
            if ($to === 'cancelled' && $from !== 'cancelled') {
                $documents->cancel($order, $admin, $note, $emailed, 'status');

                return [$order, $emailed];
            }
            $order->forceFill(['status' => $to])->save();

            $order->history()->create([
                'status' => $to,
                'payment_status' => $order->payment_status,
                'note' => $note,
                'admin_id' => $admin->id,
                'customer_notified' => $emailed,
            ]);
            $audit->record($to !== $from ? 'order.status_changed' : 'order.note_added',
                $to !== $from ? "Order {$order->number}: {$from} → {$to}." : "Note added to order {$order->number}.",
                'order', $order->id, Audit::diff(['status' => $from, 'note' => null], ['status' => $to, 'note' => $note]));

            return [$order, $emailed];
        });

        if ($statusChanged) {
            try {
                Mail::to($order->email)->send(new OrderStatusMail($order, $note));
            } catch (Throwable $e) {
                report($e); // the change is saved either way
            }
        }

        return new AdminOrderResource($this->find($order->number));
    }

    /**
     * POST /api/admin/v1/orders/{number}/payment-link → 200 { data: AdminOrderResource }
     * Phase 8: the Stripe payment link for an unpaid card order, to copy and
     * send to the customer: the one still open, or a new one (open 24 hours).
     * data.payment.url is the link; url null + error when Stripe can't be
     * reached. 422 { errors: { order } } when the order can't be paid online.
     */
    public function paymentLink(Request $request, string $number, OnlinePayments $payments): AdminOrderResource|JsonResponse
    {
        $order = Order::where('number', strtoupper($number))->first();
        if (! $order) {
            return $this->notFound();
        }
        if ($problem = $payments->payProblem($order)) {
            throw ValidationException::withMessages(['order' => $problem]);
        }
        $payment = $payments->startCheckout($order, forAdmin: true);
        $payments->recordLink($order, $request->user(), $payment);

        return (new AdminOrderResource($this->find($order->number)))->withPayment($payment);
    }

    /**
     * POST /api/admin/v1/orders/{number}/payment/check → 200 { data: AdminOrderResource, result: { found, status, message } }
     * Phase 12: asks SSLCommerz about every attempt of an SSLCommerz order and
     * records a payment that went through (invoice, or "review" when risky).
     * 422 { errors: { order } } when the order can't be checked.
     */
    public function checkPayment(Request $request, string $number, SslCommerzPayments $sslcommerz): JsonResponse
    {
        $order = Order::where('number', strtoupper($number))->first();
        if (! $order) {
            return $this->notFound();
        }
        $result = $sslcommerz->check($order, $request->user());

        return (new AdminOrderResource($this->find($order->number)))->additional(['result' => $result])->response();
    }

    private function transitionError(string $from, string $to): string
    {
        $label = fn ($status) => str_replace('_', ' ', $status);
        $allowed = Order::TRANSITIONS[$from];

        return $allowed === []
            ? "A {$label($from)} order can't be changed any more."
            : "A {$label($from)} order can't be moved to {$label($to)}. It can go to: ".implode(', ', array_map($label, $allowed)).'.';
    }

    private function filters(Request $request): array
    {
        return $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(Order::STATUSES)],
            'payment_status' => ['nullable', Rule::in(Order::PAYMENT_STATUSES)],
            'source' => ['nullable', Rule::in(Order::SOURCES)],
            'customer_id' => ['nullable', 'integer'],
            // Phase 14.
            'delivery_zone' => ['nullable', 'string', 'max:40'],
            'cod' => ['nullable', 'boolean'],
            'confirmation_status' => ['nullable', Rule::in(Order::CONFIRMATION_STATUSES)],
            // Phase 18: the courier's delivery status of the order's shipment.
            'delivery_status' => ['nullable', Rule::in(Shipment::DELIVERY_STATUSES)],
        ]);
    }

    private function filtered(array $data): Builder
    {
        return Order::query()
            ->when($data['search'] ?? null, function ($query, $search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $query->where(fn ($q) => $q->where('number', 'like', $like)->orWhere('email', 'like', $like)
                    ->orWhereHas('customer', fn ($c) => $c->whereRaw("concat(first_name, ' ', last_name) like ?", [$like]))
                    // Guests have no account: search the name on the shipping address. Text read
                    // from JSON compares case-sensitively in MySQL, hence lower() on both sides.
                    ->orWhereRaw("lower(concat(shipping_address->>'$.first_name', ' ', shipping_address->>'$.last_name')) like ?", [mb_strtolower($like)]));
            })
            ->when($data['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
            ->when($data['payment_status'] ?? null, fn ($query, $status) => $query->where('payment_status', $status))
            ->when($data['source'] ?? null, fn ($query, $source) => $query->where('source', $source))
            ->when($data['customer_id'] ?? null, fn ($query, $id) => $query->where('customer_id', $id))
            // Phase 14: delivery zone, cash on delivery or not, phone confirmation.
            ->when($data['delivery_zone'] ?? null, fn ($query, $zone) => $query->where('delivery_zone_code', $zone))
            ->when(isset($data['cod']) && $data['cod'] !== null, fn ($query) => filter_var($data['cod'], FILTER_VALIDATE_BOOLEAN)
                ? $query->where('payment_method', 'cod') : $query->where('payment_method', '!=', 'cod'))
            ->when($data['confirmation_status'] ?? null, fn ($query, $status) => $query->where('confirmation_status', $status))
            ->when($data['delivery_status'] ?? null, fn ($query, $status) => $query->whereHas('shipments', fn ($s) => $s->where('delivery_status', $status)));
    }

    private function find(string $number): ?Order
    {
        return Order::where('number', strtoupper($number))
            ->with(['items', 'customer', 'createdBy', 'history.admin', 'returns.items', 'confirmationLogs.admin', ...Order::DOCUMENTS])->first();
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Order not found.'], 404);
    }
}
