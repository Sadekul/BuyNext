<?php

namespace App\Http\Resources;

use App\Models\Order;
use App\Services\Payments\OnlinePayments;
use App\Services\Pricing;
use App\Services\Returns;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An order as its customer (or a guest with the number and email) sees it.
 * History leaves out who on staff did what, and notes the customer wasn't
 * told about (those are internal). Includes the order's invoices,
 * shipments (with tracking links), and credit memos.
 *
 * @mixin Order
 */
class OrderResource extends JsonResource
{
    /** Phase 8: the answer of a just-opened payment page (may carry an `error`), shown instead of the summary. */
    private ?array $paymentAttempt = null;

    public function withPayment(?array $payment): static
    {
        $this->paymentAttempt = $payment;

        return $this;
    }

    public function toArray(Request $request): array
    {
        return [
            'number' => $this->number,
            'status' => $this->status,
            'payment_status' => $this->payment_status,
            'payment_method' => $this->payment_method,
            'shipping_method' => ['id' => $this->shipping_method, 'label' => $this->shipping_label, 'eta' => $this->shipping_eta],
            'email' => $this->email,
            'phone' => $this->phone,
            'shipping_address' => $this->shipping_address,
            'billing_address' => $this->billing_address,
            'coupon_code' => $this->coupon_code,
            'customer_group' => $this->customer_group, // phase 6: the group's name when the order was placed (null before)
            'applied_rules' => $this->applied_rules ?? [], // phase 7: the cart price rules applied ([] before)
            'items' => self::itemsOf($this->resource),
            'totals' => self::totalsOf($this->resource),
            // Phase 10 (part B): the gift card that paid part (or all) of the order.
            'gift_card' => self::giftCardOf($this->resource),
            'placed_at' => $this->placed_at?->toIso8601ZuluString(),
            // Phase 8: { provider, paid_at, url, expires_at, can_pay } (+ error after a failed attempt; staff: reference, dashboard_url).
            'payment' => $this->payment(),
            // Phase 9 (part A): show "Cancel order" (POST /orders/{number}/cancel).
            'can_cancel' => $this->resource->customerCanCancel(),
            'history' => $this->whenLoaded('history', fn () => $this->history->map(fn ($entry) => $this->historyEntry($entry))->values()),
            // Phase 3 documents (Order::DOCUMENTS eager-loads them).
            ...$this->documents($request),
            // Phase 6: on order detail pages (the returns are loaded there): its returns and what can still be returned.
            ...($this->relationLoaded('returns') ? [
                'returns' => $this->returns->map(fn ($return) => [
                    'number' => $return->number,
                    'status' => $return->status,
                    'items_count' => (int) $return->items->sum('quantity'),
                    'created_at' => $return->created_at?->toIso8601ZuluString(),
                ])->values(),
                'return_eligibility' => app(Returns::class)->eligibility($this->resource),
            ] : []),
        ];
    }

    /** Customers: invoice and refund summaries, and shipments with tracking. */
    protected function documents(Request $request): array
    {
        return [
            'invoices' => $this->invoices->map(fn ($invoice) => [
                'number' => $invoice->number,
                'amount' => $invoice->amount,
                'created_at' => $invoice->created_at?->toIso8601ZuluString(),
            ])->values(),
            'shipments' => $this->shipments->map(fn ($shipment) => (new ShipmentResource($shipment->setRelation('order', $this->resource)))
                ->forCustomer($this->forCustomer())->toArray($request))->values(),
            'credit_memos' => $this->creditMemos->map(fn ($memo) => [
                'number' => $memo->number,
                'total' => $memo->total,
                'created_at' => $memo->created_at?->toIso8601ZuluString(),
            ])->values(),
        ];
    }

    protected function forCustomer(): bool
    {
        return true;
    }

    private function payment(): array
    {
        // Phase 10 (part B): Stripe for card orders, PayPal for PayPal orders.
        $summary = app(OnlinePayments::class)->summary($this->resource, ! $this->forCustomer());
        if ($this->paymentAttempt) {
            $summary = [...$summary, ...$this->paymentAttempt];
        }

        return $summary;
    }

    /** The item snapshots (also on invoices). */
    public static function itemsOf(Order $order): array
    {
        return $order->items->map(fn ($item) => [
            'product_id' => $item->product_id,
            'variant_id' => $item->variant_id,
            'sku' => $item->sku,
            'name' => $item->name,
            'variant_label' => $item->variant_label,
            'thumbnail_url' => $item->thumbnail_url,
            'price' => $item->unit_price,
            'discount_percent' => (float) $item->discount_percent,
            'group_discount_percent' => (float) $item->group_discount_percent,
            'sale_price' => $item->sale_price,
            'quantity' => $item->quantity,
            'line_total' => $item->line_total,
            // Phase 7: the line's share of the cart rules (null before phase 7) and its catalog price rule label.
            'discount' => $item->discount_amount,
            'price_label' => $item->price_label,
            // Phase 10 (part B): a gift card line's { amount, recipient_name, recipient_email, message } (null otherwise).
            'gift_card' => $item->gift_card,
        ])->values()->all();
    }

    /** The order totals, plus what was paid (invoices) and refunded (credit memos). */
    public static function totalsOf(Order $order): array
    {
        return [
            'item_count' => $order->itemCount(),
            'subtotal' => $order->subtotal,
            'discount' => $order->discount_total,
            'shipping' => $order->shipping_total,
            'tax' => $order->tax_total,
            'total' => $order->grand_total,
            // Phase 10 (part B): paid with a gift card, and what is left for the other payment method.
            'gift_card' => Pricing::format(Pricing::toCents($order->gift_card_amount ?? 0)),
            'amount_due' => Pricing::format($order->dueCents()),
            'paid' => Pricing::format($order->paidCents()),
            'refunded' => Pricing::format($order->refundedCents()),
        ];
    }

    /** Phase 10 (part B): { last4, amount } of the redeemed gift card, or null. */
    public static function giftCardOf(Order $order): ?array
    {
        return $order->gift_card_id && Pricing::toCents($order->gift_card_amount ?? 0) > 0
            ? ['last4' => $order->giftCard?->last4, 'amount' => Pricing::format(Pricing::toCents($order->gift_card_amount))]
            : null;
    }

    protected function historyEntry($entry): array
    {
        return [
            'status' => $entry->status,
            'payment_status' => $entry->payment_status,
            'note' => $entry->customer_notified ? $entry->note : null,
            'created_at' => $entry->created_at?->toIso8601ZuluString(),
        ];
    }
}
