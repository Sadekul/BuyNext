<?php

namespace App\Models;

use Database\Factories\ReviewFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A product review. customer_id is null for imported reviews (DummyJSON's
 * reviewers have no account here). Phase 5: customers write reviews and staff
 * moderate them (status pending → approved / rejected); only approved ones are
 * public. One review per customer per product.
 *
 * Phase 22: up to MAX_PHOTOS photos (ReviewPhoto, ordered by position).
 */
#[Fillable(['product_id', 'customer_id', 'status', 'author_name', 'rating', 'title', 'comment', 'verified_purchase', 'imported', 'created_at'])]
class Review extends Model
{
    /** @use HasFactory<ReviewFactory> */
    use HasFactory;

    public const STATUSES = ['pending', 'approved', 'rejected'];

    public const MAX_PHOTOS = 3;

    protected function casts(): array
    {
        return ['rating' => 'integer', 'verified_purchase' => 'boolean', 'imported' => 'boolean', 'created_at' => 'datetime', 'updated_at' => 'datetime'];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    /** Phase 22: every photo (hidden ones too), in order. The store shows only the visible ones. */
    public function photos(): HasMany
    {
        return $this->hasMany(ReviewPhoto::class)->orderBy('position')->orderBy('id');
    }
}
