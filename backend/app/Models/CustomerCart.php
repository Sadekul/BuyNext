<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Phase 7: a signed-in customer's cart as the storefront last validated it.
 * converted_at: they placed an order since (the cart was bought).
 */
#[Fillable(['customer_id', 'items', 'subtotal', 'item_count', 'reminded_at', 'converted_at'])]
class CustomerCart extends Model
{
    /** A reminder at most once per this many hours. */
    public const REMIND_EVERY_HOURS = 72;

    /** A cart counts as abandoned after this long without a change. */
    public const ABANDONED_AFTER_MINUTES = 60;

    protected function casts(): array
    {
        return [
            'items' => 'array',
            'subtotal' => 'decimal:2',
            'item_count' => 'integer',
            'reminded_at' => 'datetime',
            'converted_at' => 'datetime',
        ];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }
}
