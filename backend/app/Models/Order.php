<?php

namespace App\Models;

use App\Services\Pricing;
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
])]
class Order extends Model
{
    /** @use HasFactory<OrderFactory> */
    use HasFactory;

    /** closed = fully refunded (final); only a credit memo gets an order there. */
    public const STATUSES = ['pending_payment', 'processing', 'shipped', 'delivered', 'cancelled', 'closed'];

    public const PAYMENT_STATUSES = ['unpaid', 'paid', 'partially_refunded', 'refunded'];

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

    /** Phase 10 (part B): what is left to pay after the gift card (what Stripe or PayPal charge), in cents. */
    public function dueCents(): int
    {
        return max(0, Pricing::toCents($this->grand_total) - Pricing::toCents($this->gift_card_amount ?? 0));
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
    public const DOCUMENTS = ['invoices.admin', 'shipments.admin', 'creditMemos.admin', 'creditMemos.items.orderItem', 'giftCard']; // phase 10 (part B): giftCard

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
