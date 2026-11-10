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
    'customer_id', 'email', 'phone', 'status', 'payment_status', 'payment_method', 'shipping_method',
    'shipping_label', 'shipping_eta', 'coupon_code', 'subtotal', 'discount_total', 'shipping_total',
    'tax_total', 'grand_total', 'shipping_address', 'billing_address', 'placed_at',
])]
class Order extends Model
{
    /** @use HasFactory<OrderFactory> */
    use HasFactory;

    /** closed = fully refunded (final); only a credit memo gets an order there. */
    public const STATUSES = ['pending_payment', 'processing', 'shipped', 'delivered', 'cancelled', 'closed'];

    public const PAYMENT_STATUSES = ['unpaid', 'paid', 'partially_refunded', 'refunded'];

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
            'billing_address' => 'array',
            'placed_at' => 'datetime',
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

    /** What resources need to show an order with its documents (eager load, no N+1). */
    public const DOCUMENTS = ['invoices.admin', 'shipments.admin', 'creditMemos.admin', 'creditMemos.items.orderItem'];

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

    public function canMoveTo(string $status): bool
    {
        return in_array($status, self::TRANSITIONS[$this->status] ?? [], true);
    }

    public function itemCount(): int
    {
        return (int) $this->items->sum('quantity');
    }
}
