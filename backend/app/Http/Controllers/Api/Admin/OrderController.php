<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminOrderResource;
use App\Mail\OrderStatusMail;
use App\Models\Coupon;
use App\Models\Order;
use App\Models\Product;
use App\Services\OrderDocuments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

/** Orders, as shop staff manage them: list, detail, and moving them along (deliver, cancel, notes; ship and mark paid as shortcuts). */
class OrderController extends Controller
{
    /** GET /api/admin/v1/orders?search&status&payment_status&page&per_page - newest first. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(Order::STATUSES)],
            'payment_status' => ['nullable', Rule::in(Order::PAYMENT_STATUSES)],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $orders = Order::with(['items', 'customer', ...Order::DOCUMENTS])
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
            ->latest('id')
            ->paginate($data['per_page'] ?? 20)
            ->withQueryString();

        return AdminOrderResource::collection($orders);
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
    public function update(Request $request, string $number, OrderDocuments $documents): AdminOrderResource|JsonResponse
    {
        $data = $request->validate([
            'status' => ['nullable', Rule::in(Order::STATUSES)],
            'payment_status' => ['nullable', 'in:paid'],
            'note' => ['nullable', 'string', 'max:1000'],
            'notify_customer' => ['nullable', 'boolean'],
        ], [
            'status.in' => 'Choose a valid order status.',
            'payment_status.in' => 'An order can only be marked paid.',
        ]);

        if (! Order::where('number', strtoupper($number))->exists()) {
            return $this->notFound();
        }
        $notify = $data['notify_customer'] ?? true;
        $note = $data['note'] ?? null;

        [$order, $statusChanged] = DB::transaction(function () use ($number, $data, $note, $notify, $request, $documents) {
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
            if ($to === $from && ! $markPaid && blank($note)) {
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

            // Shortcut: "shipped" = a shipment without tracking (same rules as the shipment endpoint).
            if ($to === 'shipped' && $from !== 'shipped') {
                $documents->ship($order, $admin, 'other', null, $note, $emailed, historyNote: $note, errorKey: 'status');

                return [$order, $emailed];
            }

            // Only on the way INTO cancelled: a note on a cancelled order must not restock twice.
            if ($to === 'cancelled' && $from !== 'cancelled') {
                $this->restock($order);
                Coupon::releaseFor($order);
            }
            $order->forceFill(['status' => $to])->save();

            $order->history()->create([
                'status' => $to,
                'payment_status' => $order->payment_status,
                'note' => $note ?? $this->autoNote($from, $to),
                'admin_id' => $admin->id,
                'customer_notified' => $emailed,
            ]);

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

    /** Puts every item back in stock (also for products deleted since). */
    private function restock(Order $order): void
    {
        $order->load('items');
        $ids = $order->items->pluck('product_id')->filter()->sort()->values();
        $products = Product::withTrashed()->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id');

        foreach ($order->items as $item) {
            $products->get($item->product_id)?->increment('stock_quantity', $item->quantity);
        }
    }

    private function autoNote(string $from, string $to): ?string
    {
        return $to === 'cancelled' && $from !== 'cancelled' ? 'Order cancelled; items returned to stock.' : null;
    }

    private function transitionError(string $from, string $to): string
    {
        $label = fn ($status) => str_replace('_', ' ', $status);
        $allowed = Order::TRANSITIONS[$from];

        return $allowed === []
            ? "A {$label($from)} order can't be changed any more."
            : "A {$label($from)} order can't be moved to {$label($to)}. It can go to: ".implode(', ', array_map($label, $allowed)).'.';
    }

    private function find(string $number): ?Order
    {
        return Order::where('number', strtoupper($number))->with(['items', 'customer', 'history.admin', ...Order::DOCUMENTS])->first();
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Order not found.'], 404);
    }
}
