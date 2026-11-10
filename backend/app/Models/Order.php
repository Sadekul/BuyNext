<?php

namespace App\Models;

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

    public const STATUSES = ['pending_payment', 'processing', 'shipped', 'delivered', 'cancelled'];

    /** Where an admin may move an order from each status. Anything else is refused. */
    public const TRANSITIONS = [
        'pending_payment' => ['processing', 'cancelled'],
        'processing' => ['shipped', 'cancelled'],
        'shipped' => ['delivered'],
        'delivered' => [],
        'cancelled' => [],
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
