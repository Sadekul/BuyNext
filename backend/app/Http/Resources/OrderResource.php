<?php

namespace App\Http\Resources;

use App\Models\Order;
use App\Services\Payments\OnlinePayments;
use App\Services\Pricing;
use App\Services\Returns;
use App\Services\ShippingRates;
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
            'currency' => $this->resource->currencyCode(), // phase 12: every amount of this order is in it
            'locale' => $this->locale ?? 'en', // phase 13: the language the order was placed in (its emails and PDFs, unless the customer chose one)
            // Phase 13: the stored English label/ETA, translated for the request's language.
            'shipping_method' => ['id' => $this->shipping_method, 'label' => filled($this->shipping_label) ? __($this->shipping_label) : $this->shipping_label,
                'eta' => filled($this->shipping_eta) ? __($this->shipping_eta) : $this->shipping_eta],
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
            // Phase 11: { spent, amount, earned } | null.
            'reward_points' => self::rewardPointsOf($this->resource),
            'placed_at' => $this->placed_at?->toIso8601ZuluString(),
            // Phase 8: { provider, paid_at, url, expires_at, can_pay } (+ error after a failed attempt; staff: reference, dashboard_url).
            'payment' => $this->payment(),
            // Phase 9 (part A): show "Cancel order" (POST /orders/{number}/cancel).
            'can_cancel' => $this->resource->customerCanCancel(),
            // Phase 14: delivery zone and time, cash on delivery amounts, phone confirmation ("We'll call you to confirm").
            'delivery' => self::deliveryOf($this->resource),
            'cod' => $this->codSummary(),
            'confirmation_status' => $this->confirmation_status,
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
            'reward_points' => Pricing::format(Pricing::toCents($order->reward_points_amount ?? 0)), // phase 11: paid with reward points
            'amount_due' => Pricing::format($order->dueCents()),
            'cod_fee' => Pricing::format(Pricing::toCents($order->cod_fee ?? 0)), // phase 14: in the total
            'paid' => Pricing::format($order->paidCents()),
            'refunded' => Pricing::format($order->refundedCents()),
        ];
    }

    /** Phase 14: { zone_code, zone_name, eta_days_min, eta_days_max, eta } (all null for orders without a zone or delivery time). */
    public static function deliveryOf(Order $order): array
    {
        $zone = $order->delivery_zone_code ? $order->deliveryZone : null;

        return [
            'zone_code' => $order->delivery_zone_code,
            'zone_name' => $zone?->localName() ?? $order->delivery_zone_code,
            'eta_days_min' => $order->delivery_eta_min,
            'eta_days_max' => $order->delivery_eta_max,
            'eta' => ShippingRates::etaText($order->delivery_eta_min, $order->delivery_eta_max),
        ];
    }

    /** Phase 14: { fee, advance_amount, advance_paid, cod_due } for cash on delivery orders (staff also see collected), else null. */
    protected function codSummary(): ?array
    {
        if (! $this->resource->isCod()) {
            return null;
        }

        return [
            'fee' => Pricing::format(Pricing::toCents($this->cod_fee ?? 0)),
            'advance_amount' => Pricing::format(Pricing::toCents($this->advance_amount ?? 0)),
            'advance_paid' => Pricing::format(Pricing::toCents($this->advance_paid ?? 0)),
            'cod_due' => Pricing::format($this->resource->codDueCents()),
            ...($this->forCustomer() ? [] : ['collected' => Pricing::format(Pricing::toCents($this->cod_collected ?? 0))]),
        ];
    }

    /** Phase 10 (part B): { last4, amount } of the redeemed gift card, or null. */
    public static function giftCardOf(Order $order): ?array
    {
        return $order->gift_card_id && Pricing::toCents($order->gift_card_amount ?? 0) > 0
            ? ['last4' => $order->giftCard?->last4, 'amount' => Pricing::format(Pricing::toCents($order->gift_card_amount))]
            : null;
    }

    /** Phase 11: reward points spent on the order (and their value) and earned with it, or null when neither. */
    public static function rewardPointsOf(Order $order): ?array
    {
        $spent = (int) $order->reward_points_spent;

        return $spent > 0 || $order->reward_points_earned !== null
            ? ['spent' => $spent, 'amount' => Pricing::format(Pricing::toCents($order->reward_points_amount ?? 0)), 'earned' => $order->reward_points_earned]
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
