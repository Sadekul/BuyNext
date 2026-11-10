<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminOrderResource;
use App\Mail\OrderStatusMail;
use App\Models\Order;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

/** Orders, as shop staff manage them: list, detail, and moving them along (ship, deliver, cancel, mark paid). */
class OrderController extends Controller
{
    /** GET /api/admin/v1/orders?search&status&payment_status&page&per_page - newest first. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(Order::STATUSES)],
            'payment_status' => ['nullable', 'in:unpaid,paid'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $orders = Order::with(['items', 'customer'])
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
     * stock back; marking a pending_payment order paid starts processing it.
     */
    public function update(Request $request, string $number): AdminOrderResource|JsonResponse
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

        [$order, $statusChanged] = DB::transaction(function () use ($number, $data, $notify, $request) {
            // Lock the order: two staff members clicking at once can't both cancel (and restock twice).
            $order = Order::where('number', strtoupper($number))->lockForUpdate()->firstOrFail();
            $from = $order->status;
            $to = $data['status'] ?? $from;
            $markPaid = ($data['payment_status'] ?? null) === 'paid' && $order->payment_status !== 'paid';

            if ($to !== $from && ! $order->canMoveTo($to)) {
                throw ValidationException::withMessages(['status' => $this->transitionError($from, $to)]);
            }
            if ($markPaid && $to === 'cancelled') {
                throw ValidationException::withMessages(['payment_status' => 'A cancelled order can\'t be marked paid.']);
            }
            // Paid card/PayPal orders are ready to be prepared.
            if ($markPaid && $to === 'pending_payment') {
                $to = 'processing';
            }
            if ($to === $from && ! $markPaid && blank($data['note'] ?? null)) {
                throw ValidationException::withMessages(['status' => 'Choose a new status, mark the order paid, or add a note.']);
            }

            // Only on the way INTO cancelled: a note on a cancelled order must not restock twice.
            if ($to === 'cancelled' && $from !== 'cancelled') {
                $this->restock($order);
            }
            $order->forceFill(['status' => $to, 'payment_status' => $markPaid ? 'paid' : $order->payment_status])->save();

            // The customer hears about shipping, delivery, and cancellation (OrderStatusMail).
            $emailed = $notify && $to !== $from && in_array($to, OrderStatusMail::STATUSES, true);
            $order->history()->create([
                'status' => $to,
                'payment_status' => $order->payment_status,
                'note' => $data['note'] ?? $this->autoNote($from, $to, $markPaid),
                'admin_id' => $request->user()->id,
                'customer_notified' => $emailed,
            ]);

            return [$order, $emailed];
        });

        if ($statusChanged) {
            try {
                Mail::to($order->email)->send(new OrderStatusMail($order, $data['note'] ?? null));
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

    private function autoNote(string $from, string $to, bool $markPaid): ?string
    {
        return match (true) {
            $markPaid && $from !== $to => 'Payment received; order is being prepared.',
            $markPaid => 'Payment received.',
            $to === 'cancelled' && $from !== 'cancelled' => 'Order cancelled; items returned to stock.',
            default => null,
        };
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
        return Order::where('number', strtoupper($number))->with(['items', 'customer', 'history.admin'])->first();
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Order not found.'], 404);
    }
}
