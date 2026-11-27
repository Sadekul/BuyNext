<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminOrderResource;
use App\Mail\CodConfirmedMail;
use App\Mail\OrderStatusMail;
use App\Models\Order;
use App\Services\Audit;
use App\Services\BdAddresses;
use App\Services\OrderDocuments;
use App\Services\Pricing;
use App\Services\Sms\Sms;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Phase 14: Sales → To confirm. With cod.require_confirmation, new cash on
 * delivery orders wait for a phone call: confirmed (email cod_confirmed),
 * couldn't reach (try again later), or cancelled (restock, cancel email).
 * Every attempt is logged (order_confirmation_logs). orders.edit.
 */
class OrderConfirmationController extends Controller
{
    /**
     * GET /api/admin/v1/orders/to-confirm?per_page= → pending and unreachable COD orders that haven't shipped yet, oldest first.
     * Phase 18: an order shipped anyway (with a reason) or already delivered no longer needs the call, so it leaves the queue.
     */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $orders = Order::where('payment_method', 'cod')->whereIn('confirmation_status', ['pending', 'unreachable'])
            ->whereIn('status', ['pending_payment', 'processing'])
            ->with(['customer', 'deliveryZone', 'confirmationLogs'])
            ->orderBy('placed_at')->orderBy('id')
            ->paginate($data['per_page'] ?? 20)->withQueryString();

        $page = $orders->toArray();
        $page['data'] = collect($orders->items())->map(fn (Order $order) => $this->row($order))->values()->all();

        return response()->json([
            'data' => $page['data'],
            'meta' => array_intersect_key($page, array_flip(['current_page', 'from', 'last_page', 'per_page', 'to', 'total'])),
            'links' => ['first' => $page['first_page_url'], 'last' => $page['last_page_url'], 'prev' => $page['prev_page_url'], 'next' => $page['next_page_url']],
        ]);
    }

    /**
     * POST /api/admin/v1/orders/{number}/confirmation { outcome: confirmed|unreachable|cancelled, note?, reason?, notify_customer? }
     * → { data: AdminOrderResource }. 422 { errors: { order } } when the order isn't waiting for a confirmation.
     */
    public function store(Request $request, string $number, OrderDocuments $documents, Audit $audit, Sms $sms): JsonResponse
    {
        $data = $request->validate([
            'outcome' => ['required', Rule::in(['confirmed', 'unreachable', 'cancelled'])],
            'note' => ['nullable', 'string', 'max:1000'],
            'reason' => ['required_if:outcome,cancelled', 'nullable', 'string', 'max:500'],
            'notify_customer' => ['nullable', 'boolean'],
        ], [
            'outcome.in' => 'Choose confirmed, couldn\'t reach, or cancel order.',
            'reason.required_if' => 'Say why the order is cancelled.',
        ]);
        if (! Order::where('number', strtoupper($number))->exists()) {
            return response()->json(['message' => 'Order not found.'], 404);
        }
        $notify = (bool) ($data['notify_customer'] ?? true);
        $admin = $request->user();

        $order = DB::transaction(function () use ($number, $data, $admin, $documents, $audit, $notify, $sms) {
            $order = Order::where('number', strtoupper($number))->lockForUpdate()->firstOrFail();
            if (! $order->awaitsConfirmation() || in_array($order->status, ['cancelled', 'closed'], true)) {
                throw ValidationException::withMessages(['order' => $order->confirmation_status === null
                    ? 'This order doesn\'t need a phone confirmation.'
                    : 'This order isn\'t waiting for a phone confirmation (it is '.$order->confirmation_status.').']);
            }
            $note = filled($data['note'] ?? null) ? trim($data['note']) : null;
            $reason = filled($data['reason'] ?? null) ? trim($data['reason']) : null;
            $before = $order->confirmation_status;
            $order->confirmationLogs()->create(['admin_id' => $admin->id, 'outcome' => $data['outcome'],
                'note' => trim(implode(' ', array_filter([$reason, $note]))) ?: null]);
            $order->forceFill([
                'confirmation_status' => $data['outcome'],
                'confirmation_attempts' => $order->confirmation_attempts + 1,
                ...($data['outcome'] === 'confirmed' ? ['confirmed_at' => now()] : []),
            ])->save();

            if ($data['outcome'] === 'cancelled') {
                $documents->cancel($order, $admin, "Cancelled at the phone confirmation: {$reason}".($note ? " ({$note})" : ''), $notify);
            } else {
                $order->history()->create([
                    'status' => $order->status,
                    'payment_status' => $order->payment_status,
                    'note' => $data['outcome'] === 'confirmed' ? 'Order confirmed by phone.'.($note ? " {$note}" : '')
                        : 'Couldn\'t reach the customer to confirm the order.'.($note ? " {$note}" : ''),
                    'admin_id' => $admin->id,
                    'customer_notified' => $data['outcome'] === 'confirmed' && $notify,
                ]);
                // Phase 20: the "order confirmed" text with the email (sent after the commit; a cancel texts through its history step).
                if ($data['outcome'] === 'confirmed' && $notify) {
                    $sms->sendForOrder($order, 'order_confirmed');
                }
            }
            $audit->record('order.confirmation', "Order {$order->number} phone confirmation: {$data['outcome']}.", 'order', $order->id,
                ['before' => ['confirmation_status' => $before], 'after' => ['confirmation_status' => $data['outcome'], 'note' => $note, 'reason' => $reason]], $admin);

            return $order;
        });

        if ($notify && $data['outcome'] !== 'unreachable') {
            try {
                Mail::to($order->email)->send($data['outcome'] === 'confirmed' ? new CodConfirmedMail($order->load('items')) : new OrderStatusMail($order->refresh()));
            } catch (Throwable $e) {
                report($e);
            }
        }

        $order = Order::where('id', $order->id)->with(['items', 'customer', 'createdBy', 'history.admin', 'returns.items', 'confirmationLogs.admin', ...Order::DOCUMENTS])->first();

        return (new AdminOrderResource($order))->response();
    }

    private function row(Order $order): array
    {
        $address = $order->shipping_address ?? [];
        $others = Order::where('id', '!=', $order->id)->where(fn ($q) => $order->customer_id
            ? $q->where('customer_id', $order->customer_id)->orWhere('email', $order->email)
            : $q->where('email', $order->email)->orWhere('phone', $order->phone))
            ->withCount('returns')->get(['id', 'status']);
        $last = $order->confirmationLogs->last();

        return [
            'number' => $order->number,
            'placed_at' => $order->placed_at?->toIso8601ZuluString(),
            'status' => $order->status,
            'payment_status' => $order->payment_status,
            'currency' => $order->currencyCode(),
            'grand_total' => $order->grand_total,
            'cod_due' => Pricing::format($order->codDueCents()),
            'advance_paid' => Pricing::format(Pricing::toCents($order->advance_paid ?? 0)),
            'customer_name' => trim(($address['first_name'] ?? '').' '.($address['last_name'] ?? '')) ?: ($order->customer ? trim("{$order->customer->first_name} {$order->customer->last_name}") : null),
            'phone' => $order->phone,
            'tel_url' => $order->phone ? 'tel:'.preg_replace('/[^\d+]/', '', $order->phone) : null,
            'email' => $order->email,
            'address' => implode(', ', BdAddresses::lines($address, 'en') ?? array_filter([$address['line1'] ?? null, $address['line2'] ?? null,
                $address['city'] ?? null, $address['state'] ?? null, $address['postal_code'] ?? null, $address['country'] ?? null])),
            'delivery_zone' => $order->deliveryZone ? ['code' => $order->deliveryZone->code, 'name' => $order->deliveryZone->name] : null,
            'confirmation_status' => $order->confirmation_status,
            'confirmation_attempts' => (int) $order->confirmation_attempts,
            'last_note' => $last?->note,
            'last_attempt_at' => $last?->created_at?->toIso8601ZuluString(),
            'previous' => [
                'orders' => $others->count(),
                'delivered' => $others->whereIn('status', ['delivered', 'closed'])->count(),
                'cancelled' => $others->where('status', 'cancelled')->count(),
                'returns' => (int) $others->sum('returns_count'),
            ],
        ];
    }
}
