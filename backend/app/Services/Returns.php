<?php

namespace App\Services;

use App\Mail\ReturnStatusMail;
use App\Models\Admin;
use App\Models\Order;
use App\Models\OrderReturn;
use App\Support\Locale;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Returns (Magento's RMA): who may return what, and the status workflow.
 *
 * What can be returned, per order line:
 *   shipped quantity (one shipment ships every item, so the ordered quantity
 *   once the order has a shipment, else 0)
 *   − units in returns that weren't rejected (open or completed)
 *   − units refunded by credit memos that don't belong to a return
 *     (a return's own refund is already counted by the return).
 *
 * When: returns are on (Settings → Returns), the order is shipped or
 * delivered (a closed, fully refunded one has nothing left to return), and today is inside the window: return_window_days counted from
 * the first "delivered" history entry, or from the last shipment when the
 * order has no delivered date. Staff may override the window.
 *
 * Every status change adds an order history note and (with notify) emails the customer.
 */
class Returns
{
    public function __construct(private Settings $settings, private Audit $audit, private Inventory $inventory) {}

    /**
     * Whether and what the order's owner may return. Shape (the API's `return_eligibility`):
     * { eligible, code (null|returns_disabled|not_shipped|window_closed|nothing_left), message, deadline, reasons,
     *   items: [{ order_item_id, name, variant_label, sku, ordered, returnable }] }
     */
    public function eligibility(Order $order, bool $ignoreWindow = false): array
    {
        $order->loadMissing(['items', 'shipments', 'history', 'creditMemos.items', 'returns.items']);
        $returnable = $this->returnable($order);
        $deadline = $this->deadline($order);

        [$code, $message] = match (true) {
            ! $this->settings->get('returns_enabled') => ['returns_disabled', __('Returns are not available at the moment.')],
            // closed = fully refunded: it falls through to "nothing left".
            ! in_array($order->status, ['shipped', 'delivered', 'closed'], true) || $order->shipments->isEmpty() => ['not_shipped', __('Items can be returned once the order has shipped.')],
            ! $ignoreWindow && $deadline && $deadline->isPast() => ['window_closed', __('The return window for this order closed on :date.', ['date' => Locale::isBangla() ? Locale::date($deadline) : $deadline->format('F j, Y')])],
            array_sum($returnable) === 0 => ['nothing_left', __('Every item of this order has already been returned or refunded.')],
            default => [null, null],
        };

        return [
            'eligible' => $code === null,
            'code' => $code,
            'message' => $message,
            'deadline' => $deadline?->toIso8601ZuluString(),
            'window_days' => (int) $this->settings->get('return_window_days'),
            'reasons' => array_values($this->settings->get('return_reasons', [])),
            'items' => $order->items->map(fn ($item) => [
                'order_item_id' => $item->id,
                'name' => $item->name,
                'variant_label' => $item->variant_label,
                'sku' => $item->sku,
                'thumbnail_url' => $item->thumbnail_url,
                'ordered' => $item->quantity,
                'returnable' => $returnable[$item->id] ?? 0,
            ])->values()->all(),
        ];
    }

    /** order_item_id => units that can still be returned (see the class comment). */
    public function returnable(Order $order): array
    {
        $shipped = $order->shipments->isNotEmpty();
        $used = [];
        foreach ($order->returns as $return) {
            if (in_array($return->status, OrderReturn::COUNTED, true)) {
                foreach ($return->items as $item) {
                    $used[$item->order_item_id] = ($used[$item->order_item_id] ?? 0) + $item->quantity;
                }
            }
        }
        foreach ($order->creditMemos as $memo) {
            if ($memo->return_id === null) {
                foreach ($memo->items as $item) {
                    $used[$item->order_item_id] = ($used[$item->order_item_id] ?? 0) + $item->quantity;
                }
            }
        }

        // Phase 10 (part B): gift cards aren't returned by post (a credit memo takes back unused ones).
        return $order->items->mapWithKeys(fn ($item) => [$item->id => $shipped && ! $item->isGiftCard()
            ? max(0, $item->quantity - ($used[$item->id] ?? 0)) : 0])->all();
    }

    /** The last day of the return window, or null when the order hasn't shipped. */
    public function deadline(Order $order): ?Carbon
    {
        $delivered = $order->history->firstWhere('status', 'delivered')?->created_at;
        $start = $delivered ?? $order->shipments->max('created_at');

        return $start ? Carbon::parse($start)->addDays((int) $this->settings->get('return_window_days')) : null;
    }

    /**
     * Creates a return (status requested) for the order's customer. $data: validated { items: [{ order_item_id, quantity }], reason, comment? }.
     * $admin: created by staff (who may $overrideWindow). Locks the order, so two
     * requests can't both return the last unit.
     */
    public function create(Order $order, array $data, ?Admin $admin = null, bool $overrideWindow = false, bool $notify = true): OrderReturn
    {
        $return = DB::transaction(function () use ($order, $data, $admin, $overrideWindow, $notify) {
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            $eligibility = $this->eligibility($order, ignoreWindow: $admin !== null && $overrideWindow);
            if (! $eligibility['eligible']) {
                throw ValidationException::withMessages(['order' => $eligibility['message']]);
            }
            if (! in_array($data['reason'], $eligibility['reasons'], true)) {
                throw ValidationException::withMessages(['reason' => __('Choose one of the listed reasons.')]);
            }

            $returnable = collect($eligibility['items'])->keyBy('order_item_id');
            $lines = [];
            $errors = [];
            foreach ($data['items'] as $index => $line) {
                $id = (int) $line['order_item_id'];
                $item = $returnable->get($id);
                if (! $item) {
                    $errors["items.{$index}.order_item_id"] = __('This item isn\'t part of the order.');
                } elseif (isset($lines[$id])) {
                    $errors["items.{$index}.order_item_id"] = __('Each item can be listed only once.');
                } elseif ((int) $line['quantity'] > $item['returnable']) {
                    $errors["items.{$index}.quantity"] = $item['returnable'] === 0
                        ? __(':item can\'t be returned (already returned or refunded).', ['item' => $item['name']])
                        : __('Only :count of :item can be returned.', ['count' => Locale::digits($item['returnable']), 'item' => $item['name']]);
                } else {
                    $lines[$id] = (int) $line['quantity'];
                }
            }
            if ($errors) {
                throw ValidationException::withMessages($errors);
            }

            $return = OrderReturn::create([
                'order_id' => $order->id,
                'customer_id' => $order->customer_id,
                'status' => 'requested',
                'reason' => $data['reason'],
                'comment' => filled($data['comment'] ?? null) ? trim($data['comment']) : null,
                'customer_notified' => $notify,
                'created_by_admin_id' => $admin?->id,
            ]);
            $return->forceFill(['number' => OrderReturn::numberFor($return->id)])->save();
            foreach ($lines as $id => $quantity) {
                $return->items()->create(['order_item_id' => $id, 'quantity' => $quantity]);
            }

            $order->history()->create([
                'status' => $order->status,
                'payment_status' => $order->payment_status,
                'note' => "Return {$return->number} requested".($admin ? ' by staff' : '').": {$return->reason}.",
                'admin_id' => $admin?->id,
                'customer_notified' => $notify,
            ]);
            if ($admin) {
                $this->audit->record('return.created', "Return {$return->number} created for order {$order->number}.", 'return', $return->id,
                    ['before' => [], 'after' => ['order' => $order->number, 'reason' => $return->reason, 'items' => $lines,
                        'window_overridden' => $overrideWindow]], $admin);
            }

            return $return;
        });

        if ($notify) {
            $this->email($return);
        }

        return $return;
    }

    /**
     * PATCH /returns/{number}: moves a return along. $data: validated
     * { status, admin_note?, resolution?, items?: [{ return_item_id, condition }], restock? }.
     * `refunded` is reached only through a credit memo for the return (refunded()).
     */
    public function changeStatus(OrderReturn $return, Admin $admin, array $data, bool $notify): OrderReturn
    {
        $return = DB::transaction(function () use ($return, $admin, $data, $notify) {
            $return = OrderReturn::whereKey($return->id)->lockForUpdate()->with(['items.orderItem', 'order'])->firstOrFail();
            $from = $return->status;
            $to = $data['status'];

            if ($to === 'refunded') {
                throw ValidationException::withMessages(['status' => 'A return is marked refunded when you create a credit memo for it ("Refund this return").']);
            }
            if (! $return->canMoveTo($to)) {
                $allowed = OrderReturn::TRANSITIONS[$from];
                throw ValidationException::withMessages(['status' => $allowed === []
                    ? "A {$from} return can't be changed any more."
                    : "A {$from} return can't be moved to {$to}. It can go to: ".implode(', ', $allowed).'.']);
            }

            $before = ['status' => $from, 'admin_note' => $return->admin_note, 'resolution' => $return->resolution, 'restocked' => $return->restocked];
            $restocked = false;
            if ($to === 'received') {
                $conditions = collect($data['items'] ?? [])->keyBy('return_item_id');
                $unknown = $conditions->keys()->diff($return->items->pluck('id'));
                if ($unknown->isNotEmpty()) {
                    throw ValidationException::withMessages(['items' => 'Some items aren\'t part of this return.']);
                }
                foreach ($return->items as $item) {
                    if ($conditions->has($item->id)) {
                        $item->forceFill(['condition' => $conditions[$item->id]['condition']])->save();
                    }
                }
                if (! empty($data['restock'])) {
                    $this->inventory->restock($return->items->map(fn ($item) => [
                        'product_id' => $item->orderItem->product_id,
                        'variant_id' => $item->orderItem->variant_id,
                        'quantity' => $item->quantity,
                    ])->all());
                    $restocked = true;
                }
            }

            $return->fill([
                'status' => $to,
                'admin_note' => array_key_exists('admin_note', $data) && filled($data['admin_note']) ? trim($data['admin_note']) : $return->admin_note,
                'resolution' => $data['resolution'] ?? $return->resolution,
                'restocked' => $return->restocked || $restocked,
                'customer_notified' => $notify,
            ])->save();

            $this->historyNote($return, $admin, $notify, $restocked ? ' Items returned to stock.' : '');
            $this->audit->record("return.{$to}", "Return {$return->number} ({$return->order->number}): {$from} → {$to}.", 'return', $return->id,
                Audit::diff($before, ['status' => $to, 'admin_note' => $return->admin_note, 'resolution' => $return->resolution, 'restocked' => $return->restocked]),
                $admin);

            return $return;
        });

        if ($notify) {
            $this->email($return);
        }

        return $return;
    }

    /**
     * Checks that a credit memo may settle $number (inside the credit memo's
     * transaction, order locked). Returns the locked return.
     */
    public function forRefund(Order $order, string $number): OrderReturn
    {
        $return = OrderReturn::where('number', strtoupper(trim($number)))->where('order_id', $order->id)->lockForUpdate()->first();
        if (! $return) {
            throw ValidationException::withMessages(['return_number' => 'This return doesn\'t belong to the order.']);
        }
        if ($return->status !== 'received') {
            throw ValidationException::withMessages(['return_number' => "Return {$return->number} is {$return->status}: only a received return can be refunded."]);
        }

        return $return;
    }

    /** After the credit memo for $return was written: received → refunded. */
    public function refunded(OrderReturn $return, Admin $admin, string $memoNumber, bool $notify): void
    {
        $return->load('order');
        $return->fill(['status' => 'refunded', 'resolution' => 'refund', 'customer_notified' => $notify])->save();
        $this->historyNote($return, $admin, $notify, " Credit memo {$memoNumber}.");
        $this->audit->record('return.refunded', "Return {$return->number} ({$return->order->number}) refunded by credit memo {$memoNumber}.",
            'return', $return->id, ['before' => ['status' => 'received'], 'after' => ['status' => 'refunded', 'credit_memo' => $memoNumber]], $admin);
    }

    /** Sends the status email for the return's current status (after the commit; a failed email changes nothing). */
    public function email(OrderReturn $return): void
    {
        try {
            $return->loadMissing(['order', 'items.orderItem']);
            Mail::to($return->order->email)->send(new ReturnStatusMail($return));
        } catch (Throwable $e) {
            report($e);
        }
    }

    private function historyNote(OrderReturn $return, Admin $admin, bool $notify, string $extra = ''): void
    {
        $order = $return->order;
        $order->history()->create([
            'status' => $order->status,
            'payment_status' => $order->payment_status,
            'note' => "Return {$return->number} {$return->status}.{$extra}".($return->admin_note && $return->wasChanged('admin_note') ? " {$return->admin_note}" : ''),
            'admin_id' => $admin->id,
            'customer_notified' => $notify,
        ]);
    }
}
