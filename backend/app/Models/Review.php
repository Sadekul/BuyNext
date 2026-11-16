<?php

namespace App\Models;

use Database\Factories\ReviewFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A product review. customer_id is null for imported reviews (DummyJSON's
 * reviewers have no account here). Phase 5: customers write reviews and staff
 * moderate them (status pending → approved / rejected); only approved ones are
 * public. One review per customer per product.
 */
#[Fillable(['product_id', 'customer_id', 'status', 'author_name', 'rating', 'title', 'comment', 'verified_purchase', 'created_at'])]
class Review extends Model
{
    /** @use HasFactory<ReviewFactory> */
    use HasFactory;

    public const STATUSES = ['pending', 'approved', 'rejected'];

    protected function casts(): array
    {
        return ['rating' => 'integer', 'verified_purchase' => 'boolean', 'created_at' => 'datetime', 'updated_at' => 'datetime'];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }
}
