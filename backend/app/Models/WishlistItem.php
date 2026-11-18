<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Phase 11: a product (and optionally a variant) on a signed-in customer's wishlist. */
#[Fillable(['customer_id', 'product_id', 'product_variant_id', 'note'])]
class WishlistItem extends Model
{
    public const UPDATED_AT = null;

    /** How many items one wishlist may hold. */
    public const LIMIT = 100;

    /** variant_key = the variant id, or 0 (for the unique key). */
    protected static function booted(): void
    {
        static::saving(fn (WishlistItem $item) => $item->variant_key = $item->product_variant_id ?? 0);
    }

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }

    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class, 'product_variant_id');
    }
}
