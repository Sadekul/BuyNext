<?php

namespace App\Models;

use App\Services\Pricing;
use App\Services\ShippingRates;
use App\Support\Currency;
use Database\Factories\OrderFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * An order. Totals and items are snapshots taken at checkout. Status and
 * payment are separate: a cash-on-delivery order is `processing` but `unpaid`
 * until the courier collects the money.
 */
#[Fillable([
    'customer_id', 'customer_group', 'source', 'created_by_admin_id', 'email', 'phone', 'status', 'payment_status', 'payment_method', 'shipping_method',
    'shipping_label', 'shipping_eta', 'coupon_code', 'applied_rules', 'subtotal', 'discount_total', 'shipping_total',
    'tax_total', 'grand_total', 'shipping_address', 'billing_address', 'placed_at',
    'gift_card_id', 'gift_card_amount', // phase 10 (part B)
    'reward_points_spent', 'reward_points_amount', 'reward_points_earned', // phase 11
    'currency', // phase 12
    'locale', // phase 13: the language the order was placed in (en|bn)
    // Phase 14: delivery zone, cash on delivery, phone confirmation.
    'delivery_zone_code', 'delivery_eta_min', 'delivery_eta_max', 'cod_fee', 'advance_amount', 'cod_due', 'confirmation_status',
])]
class Order extends Model
{
    /** @use HasFactory<OrderFactory> */
    use HasFactory;

    /** closed = fully refunded (final); only a credit memo gets an order there. */
    public const STATUSES = ['pending_payment', 'processing', 'shipped', 'delivered', 'cancelled', 'closed'];

    /** Phase 12: review = an online payment was taken but flagged as risky (SSLCommerz risk level 1): staff approve it (invoice) or cancel. */
    public const PAYMENT_STATUSES = ['unpaid', 'review', 'paid', 'partially_refunded', 'refunded',
        'partially_paid', // phase 14: a COD order's advance (or part of the cash) is paid, the rest is still to collect
    ];

    /** Phase 14: phone confirmation of cash on delivery orders (cod.require_confirmation). */
    public const CONFIRMATION_STATUSES = ['pending', 'confirmed', 'unreachable', 'cancelled'];

    /** Phase 6: storefront checkout, or staff creating the order in the admin. */
    public const SOURCES = ['storefront', 'admin'];

    /** Orders that are still being handled (a customer with one can't be deleted). */
    public const OPEN_STATUSES = ['pending_payment', 'processing', 'shipped'];

    /** Payment methods that may ship before an invoice (the money is collected on delivery / in person). */
    public const PAY_LATER_METHODS = ['cod', 'cash'];

    /**
     * Where an admin may move an order from each status with PATCH. Anything
     * else is refused. (Cancelling is also refused once there is an invoice,
     * and `closed` is reached only through a full credit memo.)
     */
    public const TRANSITIONS = [
        'pending_payment' => ['processing', 'cancelled'],
        'processing' => ['shipped', 'cancelled'],
        'shipped' => ['delivered'],
        'delivered' => [],
        'cancelled' => [],
        'closed' => [],
    ];

    protected function casts(): array
    {
        return [
            'subtotal' => 'decimal:2',
            'discount_total' => 'decimal:2',
            'shipping_total' => 'decimal:2',
            'tax_total' => 'decimal:2',
            'grand_total' => 'decimal:2',
            'shipping_address' => 'array',
            'applied_rules' => 'array', // phase 7: the cart price rules applied (CartRules::summary())
            'billing_address' => 'array',
            'placed_at' => 'datetime',
            // Phase 8: Stripe Checkout (see App\Services\Payments\StripePayments).
            'payment_expires_at' => 'datetime',
            'paid_at' => 'datetime',
            'gift_card_amount' => 'decimal:2', // phase 10 (part B): paid with the redeemed gift card
            // Phase 11: reward points spent on the order (and their money value), and earned when it was invoiced (null before / guests / off).
            'reward_points_spent' => 'integer',
            'reward_points_amount' => 'decimal:2',
            'reward_points_earned' => 'integer',
            'payment_details' => 'array', // phase 12: SSLCommerz's transaction details
            // Phase 14.
            'delivery_eta_min' => 'integer',
            'delivery_eta_max' => 'integer',
            'cod_fee' => 'decimal:2',
            'advance_amount' => 'decimal:2',
            'advance_paid' => 'decimal:2',
            'advance_refunded' => 'decimal:2',
            'cod_due' => 'decimal:2',
            'cod_collected' => 'decimal:2',
            'confirmation_attempts' => 'integer',
            'confirmed_at' => 'datetime',
        ];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class)->orderBy('id');
    }

    public function history(): HasMany
    {
        return $this->hasMany(OrderStatusHistory::class)->orderBy('id');
    }

    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class)->orderBy('id');
    }

    public function shipments(): HasMany
    {
        return $this->hasMany(Shipment::class)->orderBy('id');
    }

    public function creditMemos(): HasMany
    {
        return $this->hasMany(CreditMemo::class)->orderBy('id');
    }

    /** Phase 10 (part B): the gift card redeemed on this order. */
    public function giftCard(): BelongsTo
    {
        return $this->belongsTo(GiftCard::class);
    }

    /** Phase 10 (part B): what is left to pay after the gift card (what Stripe or PayPal charge), in cents. Phase 11: and the reward points. */
    public function dueCents(): int
    {
        return max(0, Pricing::toCents($this->grand_total) - Pricing::toCents($this->gift_card_amount ?? 0)
            - Pricing::toCents($this->reward_points_amount ?? 0));
    }

    /** Phase 14: the phone confirmation attempts (and staff overrides), oldest first. */
    public function confirmationLogs(): HasMany
    {
        return $this->hasMany(OrderConfirmationLog::class)->orderBy('id');
    }

    public function deliveryZone(): BelongsTo
    {
        return $this->belongsTo(DeliveryZone::class, 'delivery_zone_code', 'code');
    }

    public function isCod(): bool
    {
        return $this->payment_method === 'cod';
    }

    /** Phase 14: a COD order that pays the delivery charge (+ fee) online first. */
    public function hasAdvance(): bool
    {
        return $this->isCod() && Pricing::toCents($this->advance_amount ?? 0) > 0;
    }

    /** Phase 14: what an online payment of this order charges: the advance of a COD order, else the amount due. */
    public function onlineDueCents(): int
    {
        return $this->hasAdvance() ? Pricing::toCents($this->advance_amount) : $this->dueCents();
    }

    /**
     * Phase 14: the cash still to collect on delivery (COD orders; 0 for others).
     * Orders from before phase 14 have no cod_due: everything due, until invoiced.
     */
    public function codDueCents(): int
    {
        if (! $this->isCod()) {
            return 0;
        }
        if ($this->cod_due !== null) {
            return Pricing::toCents($this->cod_due);
        }

        return in_array($this->payment_status, ['unpaid', 'review'], true) ? $this->dueCents() : 0;
    }

    /**
     * Phase 14: "Inside Dhaka · Delivery in 1–2 days" in the current language
     * (the zone and/or the zone rate's delivery time); null when the order has neither.
     */
    public function deliveryText(): ?string
    {
        $zone = $this->delivery_zone_code ? ($this->deliveryZone?->localName() ?? $this->delivery_zone_code) : null;
        $eta = ShippingRates::etaText($this->delivery_eta_min, $this->delivery_eta_max);

        return $zone || $eta ? implode(' · ', array_filter([$zone, $eta])) : null;
    }

    /** Phase 14: does this COD order use any of the Bangladesh COD extras (zone, fee, advance)? Then emails say more. */
    public function usesBangladeshCod(): bool
    {
        return $this->isCod() && ($this->delivery_zone_code !== null || Pricing::toCents($this->cod_fee ?? 0) > 0 || $this->hasAdvance());
    }

    /** Phase 14: may this COD order not ship yet (waiting for, or not reached by, the phone confirmation)? */
    public function awaitsConfirmation(): bool
    {
        return $this->isCod() && in_array($this->confirmation_status, ['pending', 'unreachable'], true);
    }

    /** Phase 12: the order's currency code (USD for orders placed before phase 12). */
    public function currencyCode(): string
    {
        return strtoupper((string) ($this->currency ?: 'USD'));
    }

    /** Phase 12: an amount of this order as a person reads it ("৳1,250.00"). */
    public function money(string|int|float|null $amount): string
    {
        return Currency::format($amount, $this->currencyCode());
    }

    public function returns(): HasMany
    {
        return $this->hasMany(OrderReturn::class)->orderBy('id');
    }

    /** The admin who placed the order (source "admin"). */
    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(Admin::class, 'created_by_admin_id');
    }

    /** What resources need to show an order with its documents (eager load, no N+1). */
    public const DOCUMENTS = ['invoices.admin', 'shipments.admin', 'creditMemos.admin', 'creditMemos.items.orderItem', 'giftCard', 'deliveryZone']; // phase 10 (part B): giftCard

    /** Money recorded by invoices, in cents. */
    public function paidCents(): int
    {
        return $this->invoices->sum(fn (Invoice $invoice) => Pricing::toCents($invoice->amount));
    }

    /** Money given back by credit memos, in cents. */
    public function refundedCents(): int
    {
        return $this->creditMemos->sum(fn (CreditMemo $memo) => Pricing::toCents($memo->total));
    }

    public static function numberFor(int $id): string
    {
        return 'BN-'.(100000 + $id);
    }

    /**
     * Phase 9 (part A): the customer (or a guest with the order's email) may
     * cancel it themselves: not paid, nothing invoiced or shipped yet.
     * Refunds stay with staff.
     */
    public function customerCanCancel(): bool
    {
        return in_array($this->status, ['pending_payment', 'processing'], true)
            && $this->payment_status === 'unpaid'
            && $this->invoices->isEmpty()
            && $this->shipments->isEmpty();
    }

    public function canMoveTo(string $status): bool
    {
        return in_array($status, self::TRANSITIONS[$this->status] ?? [], true);
    }

    public function itemCount(): int
    {
        return (int) $this->items->sum('quantity');
    }
}
