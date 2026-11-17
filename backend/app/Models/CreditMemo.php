<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A refund (Magento's credit memo): some items, some shipping, and an
 * adjustment (negative = a fee the shop keeps). total = items + shipping +
 * adjustment. "CM-100001". Phase 8: on an order paid through Stripe the
 * money goes back to the card (refund_reference = the Stripe refund id);
 * otherwise the memo records that staff returned it by the original method.
 */
#[Fillable(['order_id', 'return_id', 'subtotal', 'shipping_refund', 'adjustment', 'total', 'refund_reference', 'restocked', 'admin_id', 'note', 'customer_notified'])]
class CreditMemo extends Model
{
    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return [
            'subtotal' => 'decimal:2',
            'shipping_refund' => 'decimal:2',
            'adjustment' => 'decimal:2',
            'total' => 'decimal:2',
            'restocked' => 'boolean',
            'customer_notified' => 'boolean',
        ];
    }

    public static function numberFor(int $id): string
    {
        return 'CM-'.(100000 + $id);
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function admin(): BelongsTo
    {
        return $this->belongsTo(Admin::class);
    }

    /** Phase 6: the return this refund settled, if any. */
    public function orderReturn(): BelongsTo
    {
        return $this->belongsTo(OrderReturn::class, 'return_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(CreditMemoItem::class)->orderBy('id');
    }
}
