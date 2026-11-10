<?php

namespace App\Services;

use App\Models\Admin;
use App\Models\CreditMemo;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use Illuminate\Validation\ValidationException;

/**
 * Credit memos (refunds), all in integer cents.
 *
 * What a unit is worth = what the customer actually paid for it:
 *   1. Each line's share of the order's coupon discount is proportional to
 *      its line total, rounded to the cent. Shares are floored, and the
 *      leftover cents go one by one to the lines with the largest dropped
 *      fractions, so the shares always add up to exactly the discount.
 *   2. line paid = line total − its share. Every unit is worth
 *      floor(line paid / quantity); the LAST refundable unit of the line also
 *      takes the remainder. So refunding everything gives back exactly what
 *      was paid, whichever order the units are refunded in.
 */
class Refunds
{
    /**
     * The limits for the admin's refund form (GET .../refundable), in cents:
     * [items => [order_item_id => [item, ordered, refunded, refundable, unit_cents, paid_cents]],
     *  shipping_cents, max_cents]. $order needs items and creditMemos.items loaded.
     */
    public function limits(Order $order): array
    {
        $paid = $this->linePaidCents($order);
        $refunded = [];
        $shippingRefunded = 0;
        foreach ($order->creditMemos as $memo) {
            $shippingRefunded += Pricing::toCents($memo->shipping_refund);
            foreach ($memo->items as $memoItem) {
                $refunded[$memoItem->order_item_id] = ($refunded[$memoItem->order_item_id] ?? 0) + $memoItem->quantity;
            }
        }

        $items = [];
        foreach ($order->items as $item) {
            $done = $refunded[$item->id] ?? 0;
            $items[$item->id] = [
                'item' => $item,
                'ordered' => $item->quantity,
                'refunded' => $done,
                'refundable' => $item->quantity - $done,
                'unit_cents' => intdiv($paid[$item->id], max(1, $item->quantity)),
                'paid_cents' => $paid[$item->id],
            ];
        }

        // Nothing can be refunded before a payment was recorded.
        $isPaid = in_array($order->payment_status, ['paid', 'partially_refunded'], true);

        return [
            'items' => $items,
            'shipping_cents' => $isPaid ? max(0, Pricing::toCents($order->shipping_total) - $shippingRefunded) : 0,
            'max_cents' => $isPaid ? max(0, $order->paidCents() - $order->refundedCents()) : 0,
        ];
    }

    /** Money for $quantity more units of a line (see the class comment). */
    public function amountCents(array $limit, int $quantity): int
    {
        $amount = $limit['unit_cents'] * $quantity;
        if ($quantity > 0 && $quantity === $limit['refundable']) {
            $amount += $limit['paid_cents'] - $limit['unit_cents'] * $limit['ordered']; // the remainder
        }

        return $amount;
    }

    /** The order's payload for GET /api/admin/v1/orders/{number}/refundable. */
    public function refundable(Order $order): array
    {
        $limits = $this->limits($order);

        return [
            'items' => array_values(array_map(fn (array $limit) => [
                'order_item_id' => $limit['item']->id,
                'name' => $limit['item']->name,
                'sku' => $limit['item']->sku,
                'ordered' => $limit['ordered'],
                'refunded' => $limit['refunded'],
                'refundable' => $limit['refundable'],
                'unit_refund' => Pricing::format($limit['unit_cents']),
            ], $limits['items'])),
            'shipping_refundable' => Pricing::format($limits['shipping_cents']),
            'max_total' => Pricing::format($limits['max_cents']),
        ];
    }

    /**
     * Creates a credit memo. Inside a transaction, with the order locked.
     * $data: validated { items: [{order_item_id, quantity}], shipping_refund, adjustment, restock, note }.
     */
    public function refund(Order $order, Admin $admin, array $data, bool $notify): CreditMemo
    {
        if (! in_array($order->payment_status, ['paid', 'partially_refunded'], true)) {
            throw ValidationException::withMessages(['order' => $order->payment_status === 'refunded'
                ? 'This order has already been fully refunded.'
                : 'This order hasn\'t been paid yet, so there is nothing to refund. Invoice it first.']);
        }

        $order->load(['items', 'invoices', 'creditMemos.items']);
        $limits = $this->limits($order);

        $lines = [];
        $errors = [];
        foreach ($data['items'] ?? [] as $index => $line) {
            $id = (int) $line['order_item_id'];
            $quantity = (int) $line['quantity'];
            $limit = $limits['items'][$id] ?? null;
            if (! $limit) {
                $errors["items.{$index}.order_item_id"] = 'This item isn\'t part of the order.';
            } elseif (isset($lines[$id])) {
                $errors["items.{$index}.order_item_id"] = 'Each item can be listed only once.';
            } elseif ($quantity > $limit['refundable']) {
                $errors["items.{$index}.quantity"] = $limit['refundable'] === 0
                    ? "{$limit['item']->name} has already been fully refunded."
                    : "Only {$limit['refundable']} of {$limit['item']->name} can be refunded.";
            } elseif ($quantity > 0) { // rows left at 0 are simply not refunded
                $lines[$id] = ['item' => $limit['item'], 'quantity' => $quantity, 'amount_cents' => $this->amountCents($limit, $quantity)];
            }
        }

        $shipping = Pricing::toCents($data['shipping_refund'] ?? 0);
        if ($shipping > $limits['shipping_cents']) {
            $errors['shipping_refund'] = 'At most $'.Pricing::format($limits['shipping_cents']).' of shipping can be refunded.';
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        $subtotal = array_sum(array_column($lines, 'amount_cents'));
        $adjustment = Pricing::toCents($data['adjustment'] ?? 0);
        $total = $subtotal + $shipping + $adjustment;
        if ($total <= 0) {
            throw ValidationException::withMessages(['total' => 'The refund total must be more than $0.00.']);
        }
        if ($total > $limits['max_cents']) {
            throw ValidationException::withMessages(['total' => 'The refund can\'t be more than $'.Pricing::format($limits['max_cents'])
                .' (what was paid and not refunded yet).']);
        }

        $restock = (bool) ($data['restock'] ?? false) && $lines !== [];
        $memo = $order->creditMemos()->create([
            'subtotal' => Pricing::format($subtotal),
            'shipping_refund' => Pricing::format($shipping),
            'adjustment' => Pricing::format($adjustment),
            'total' => Pricing::format($total),
            'restocked' => $restock,
            'admin_id' => $admin->id,
            'note' => $data['note'] ?? null,
            'customer_notified' => $notify,
        ]);
        $memo->forceFill(['number' => CreditMemo::numberFor($memo->id)])->save();
        foreach ($lines as $id => $line) {
            $memo->items()->create(['order_item_id' => $id, 'quantity' => $line['quantity'], 'amount' => Pricing::format($line['amount_cents'])]);
        }
        if ($restock) {
            $this->restock($lines);
        }

        // Full refund: the money is all back, or nothing is left to refund but
        // a fee the shop kept (negative adjustment). Then the order is closed.
        $order->load('creditMemos');
        $itemsLeft = collect($limits['items'])->sum(fn ($limit) => $limit['refundable'] - ($lines[$limit['item']->id]['quantity'] ?? 0));
        $full = $order->refundedCents() >= $order->paidCents() || ($itemsLeft === 0 && $shipping === $limits['shipping_cents']);
        $order->forceFill([
            'payment_status' => $full ? 'refunded' : 'partially_refunded',
            'status' => $full ? 'closed' : $order->status,
        ])->save();

        $order->history()->create([
            'status' => $order->status,
            'payment_status' => $order->payment_status,
            'note' => "Credit memo {$memo->number} created; \${$memo->total} refunded.".($restock ? ' Items returned to stock.' : ''),
            'admin_id' => $admin->id,
            'customer_notified' => $notify,
        ]);

        return $memo;
    }

    /** order_item_id => what the customer paid for the whole line, in cents (step 1 of the class comment). */
    private function linePaidCents(Order $order): array
    {
        $discount = Pricing::toCents($order->discount_total);
        $lineCents = $order->items->mapWithKeys(fn (OrderItem $item) => [$item->id => Pricing::toCents($item->line_total)])->all();
        $subtotal = array_sum($lineCents);

        $shares = [];
        $dropped = [];
        foreach ($lineCents as $id => $cents) {
            $exact = $subtotal > 0 ? $discount * $cents : 0; // share × subtotal, kept in integers
            $shares[$id] = $subtotal > 0 ? intdiv($exact, $subtotal) : 0;
            $dropped[$id] = $subtotal > 0 ? $exact % $subtotal : 0;
        }
        // Hand out the leftover cents: biggest dropped fraction first, then the earlier line.
        $leftover = $discount - array_sum($shares);
        uksort($dropped, fn ($a, $b) => [$dropped[$b], $a] <=> [$dropped[$a], $b]);
        foreach (array_keys($dropped) as $id) {
            if ($leftover-- <= 0) {
                break;
            }
            $shares[$id]++;
        }

        return array_map(fn ($id) => $lineCents[$id] - $shares[$id], array_combine(array_keys($lineCents), array_keys($lineCents)));
    }

    /** Puts refunded units back in stock: only products that still exist (not deleted). */
    private function restock(array $lines): void
    {
        $ids = collect($lines)->map(fn ($line) => $line['item']->product_id)->filter()->unique()->sort()->values();
        $products = Product::whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id');

        foreach ($lines as $line) {
            $products->get($line['item']->product_id)?->increment('stock_quantity', $line['quantity']);
        }
    }
}
