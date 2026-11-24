<?php

namespace App\Services;

use App\Models\Admin;
use App\Models\CreditMemo;
use App\Models\Order;
use App\Models\OrderItem;
use App\Services\Payments\OnlinePayments;
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
 *   3. Tax (phase 4): when tax was added on top of the prices, it is shared
 *      out the same way over the lines and the shipping, so a unit's refund
 *      includes its tax and "shipping refundable" includes the shipping's tax.
 *      A full refund still gives back exactly the grand total. When prices
 *      include tax (or tax is off) there is nothing extra to share.
 */
class Refunds
{
    public function __construct(private Audit $audit, private Inventory $inventory, private OnlinePayments $payments, private GiftCards $giftCards,
        private RewardPoints $rewardPoints) {}

    /**
     * The limits for the admin's refund form (GET .../refundable), in cents:
     * [items => [order_item_id => [item, ordered, refunded, refundable, unit_cents, paid_cents]],
     *  shipping_cents, max_cents]. $order needs items and creditMemos.items loaded.
     */
    public function limits(Order $order): array
    {
        [$paid, $shippingPaid] = $this->paidShares($order);
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
        // Phase 14: partially_paid = a COD order's advance (or part of the cash) was paid.
        $isPaid = in_array($order->payment_status, ['paid', 'partially_refunded', 'partially_paid'], true);

        return [
            'items' => $items,
            'shipping_cents' => $isPaid ? max(0, $shippingPaid - $shippingRefunded) : 0,
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
                'variant_label' => $limit['item']->variant_label,
                'sku' => $limit['item']->sku,
                'ordered' => $limit['ordered'],
                'refunded' => $limit['refunded'],
                'refundable' => $limit['refundable'],
                'unit_refund' => Pricing::format($limit['unit_cents']),
            ], $limits['items'])),
            'shipping_refundable' => Pricing::format($limits['shipping_cents']),
            'max_total' => Pricing::format($limits['max_cents']),
            // Phase 10 (part B): a refund goes back to the redeemed gift card first, up to this much.
            'gift_card_refundable' => Pricing::format(min($limits['max_cents'], $this->giftCards->refundableCents($order))),
            // Phase 11: refunds settle reward points first (money returned as points), then the gift card, then the payment method.
            'reward_points_refundable' => Pricing::format(min($limits['max_cents'], $this->rewardPoints->refundableCents($order))),
            'reward_points' => [
                'spent' => (int) $order->reward_points_spent,
                'earned' => $order->reward_points_earned,
                'reversed' => (int) $order->creditMemos->sum('reward_points_reversed'),
            ],
        ];
    }

    /**
     * Creates a credit memo. Inside a transaction, with the order locked.
     * $data: validated { items: [{order_item_id, quantity}], shipping_refund, adjustment, restock, note }.
     */
    public function refund(Order $order, Admin $admin, array $data, bool $notify): CreditMemo
    {
        if (! in_array($order->payment_status, ['paid', 'partially_refunded', 'partially_paid'], true)) {
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
                $lines[$id] = ['item' => $limit['item'], 'quantity' => $quantity, 'amount_cents' => $this->amountCents($limit, $quantity), 'index' => $index];
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

        // Phase 10 (part B): refunded gift card purchases take back (disable) unused cards; gift cards aren't restocked.
        foreach ($lines as $line) {
            if ($line['item']->isGiftCard()) {
                $this->giftCards->disableForRefund($line['item'], $line['quantity'], "items.{$line['index']}.quantity");
            }
        }
        $stockLines = array_filter($lines, fn ($line) => ! $line['item']->isGiftCard());
        $restock = (bool) ($data['restock'] ?? false) && $stockLines !== [];
        // Phase 11: reward points are settled first, then (phase 10, part B) the redeemed gift card; only the rest goes to the card / PayPal.
        $pointsRefund = min($total, $this->rewardPoints->refundableCents($order));
        $giftCardRefund = min($total - $pointsRefund, $this->giftCards->refundableCents($order));
        $otherRefund = $total - $pointsRefund - $giftCardRefund;
        // Phase 8: an order paid through Stripe (phase 10: or PayPal) gets the money back BEFORE the memo is
        // saved: the provider refusing throws a 422 and the transaction keeps nothing. Others: refunded by hand.
        // Phase 14: a COD order's advance went through SSLCommerz: up to what is left of it goes back there first, the rest by hand (cash).
        $onlineRefund = $order->isCod() ? min($otherRefund, max(0, Pricing::toCents($order->advance_paid ?? 0) - Pricing::toCents($order->advance_refunded ?? 0)))
            : $otherRefund;
        $refundReference = $onlineRefund > 0 ? $this->payments->refund($order, $onlineRefund, $order->creditMemos->count() + 1) : null;
        if ($order->isCod() && $refundReference) {
            $order->forceFill(['advance_refunded' => Pricing::format(Pricing::toCents($order->advance_refunded ?? 0) + $onlineRefund)])->save();
        }
        $memo = $order->creditMemos()->create([
            'return_id' => $data['return_id'] ?? null, // phase 6: the return this refund settles
            'subtotal' => Pricing::format($subtotal),
            'shipping_refund' => Pricing::format($shipping),
            'adjustment' => Pricing::format($adjustment),
            'total' => Pricing::format($total),
            'gift_card_refund' => Pricing::format($giftCardRefund),
            'reward_points_refund' => Pricing::format($pointsRefund),
            'refund_reference' => $refundReference,
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
            $this->restock($stockLines);
        }
        $this->giftCards->refundTo($order, $giftCardRefund, $memo);
        // Phase 11: spent points come back in proportion; earned points are taken back in proportion (never below 0).
        $shortfall = $this->rewardPoints->refund($order, $memo);

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
            'note' => "Credit memo {$memo->number} created; {$order->money($memo->total)} refunded"
                .($pointsRefund > 0 ? ' ('.$order->money(Pricing::format($pointsRefund)).' as '.number_format($memo->reward_points_returned).' reward points)' : '')
                .($giftCardRefund > 0 ? ' ('.$order->money(Pricing::format($giftCardRefund)).' to the gift card)' : '')
                .match (true) {
                    $refundReference && $order->payment_provider === 'paypal' => ' through PayPal.',
                    $refundReference && $order->isCod() && $onlineRefund < $otherRefund => ' ('.$order->money(Pricing::format($onlineRefund))
                        .' of it through SSLCommerz, the rest by hand).', // phase 14: the COD advance
                    $refundReference && $order->payment_provider === 'sslcommerz' => ' through SSLCommerz.', // phase 12
                    (bool) $refundReference => ' to the card through Stripe.',
                    default => '.',
                }.($restock ? ' Items returned to stock.' : '')
                .($memo->reward_points_reversed > 0 ? ' '.number_format($memo->reward_points_reversed).' earned reward points taken back.' : '')
                .($shortfall > 0 ? " {$shortfall} earned reward ".($shortfall === 1 ? 'point' : 'points').' could not be taken back (balance too low).' : ''),
            'admin_id' => $admin->id,
            'customer_notified' => $notify,
        ]);

        $this->audit->record('credit_memo.created', "Credit memo {$memo->number} created for order {$order->number}: {$order->money($memo->total)} refunded.",
            'credit_memo', $memo->id, ['before' => [], 'after' => [
                'order' => $order->number, 'subtotal' => $memo->subtotal, 'shipping_refund' => $memo->shipping_refund,
                'adjustment' => $memo->adjustment, 'total' => $memo->total, 'restocked' => $restock, 'payment_status' => $order->payment_status,
                ...($refundReference ? ['refund_reference' => $refundReference] : []),
                ...($giftCardRefund > 0 ? ['gift_card_refund' => $memo->gift_card_refund] : []),
                ...($pointsRefund > 0 || $memo->reward_points_reversed > 0 ? ['reward_points_refund' => $memo->reward_points_refund,
                    'reward_points_returned' => $memo->reward_points_returned, 'reward_points_reversed' => $memo->reward_points_reversed] : []),
            ]], $admin);

        return $memo;
    }

    /**
     * [order_item_id => what the customer paid for the whole line, shipping paid], in cents.
     * Step 1 of the class comment, then step 3: tax that was added on top of
     * the prices (tax enabled, prices without tax) is shared out the same way
     * over the lines (after their discount) and the shipping.
     */
    private function paidShares(Order $order): array
    {
        $lineCents = $order->items->mapWithKeys(fn (OrderItem $item) => [$item->id => Pricing::toCents($item->line_total)])->all();
        // Phase 7: each line's own share of the cart rules (a rule for some lines only never touches the others);
        // orders from before share the order's discount in proportion.
        $discountShares = $order->items->every(fn (OrderItem $item) => $item->discount_amount !== null)
            ? $order->items->mapWithKeys(fn (OrderItem $item) => [$item->id => Pricing::toCents($item->discount_amount)])->all()
            : $this->share(Pricing::toCents($order->discount_total), $lineCents);
        $paid = array_map(fn ($id) => $lineCents[$id] - $discountShares[$id], array_combine(array_keys($lineCents), array_keys($lineCents)));
        // Phase 14: the cash on delivery fee is refunded with the shipping.
        $shipping = Pricing::toCents($order->shipping_total) + Pricing::toCents($order->cod_fee ?? 0);

        // The tax on top = what the order costs beyond merchandise and shipping (0 when tax was off or included in the prices).
        $taxOnTop = Pricing::toCents($order->grand_total) - (array_sum($paid) + $shipping);
        if ($taxOnTop > 0) {
            // Phase 10 (part B): gift card lines carry no tax, so they get no share of it.
            $taxed = array_diff_key($paid, array_flip($order->items->filter(fn (OrderItem $item) => $item->isGiftCard())->pluck('id')->all()));
            $taxShares = $this->share($taxOnTop, $taxed + ['shipping' => $shipping]); // + keeps the item ids as keys
            $shipping += $taxShares['shipping'];
            unset($taxShares['shipping']);
            foreach ($taxShares as $id => $cents) {
                $paid[$id] += $cents;
            }
        }

        return [$paid, $shipping];
    }

    private function share(int $total, array $weights): array
    {
        return Pricing::share($total, $weights);
    }

    /** Puts refunded units back in stock (the variant, for variant lines): only products that still exist (not deleted). */
    private function restock(array $lines): void
    {
        $this->inventory->restock(array_values(array_map(fn ($line) => [
            'product_id' => $line['item']->product_id,
            'variant_id' => $line['item']->variant_id,
            'quantity' => $line['quantity'],
        ], $lines)));
    }
}
