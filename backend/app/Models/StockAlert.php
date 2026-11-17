<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Phase 9 (part B): someone asked to be emailed when a sold-out product (or
 * one variant of it) is back. Waiting while notified_at is null; then the
 * row stays as a record (and so its "stop these alerts" link keeps working).
 * See App\Services\StockAlerts.
 */
class StockAlert extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    protected $hidden = ['token_hash', 'waiting_key'];

    protected function casts(): array
    {
        return ['created_at' => 'datetime', 'notified_at' => 'datetime'];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }

    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    /** The unique key of a waiting alert: one per (product, variant, email). */
    public static function waitingKey(int $productId, ?int $variantId, string $email): string
    {
        return hash('sha256', $productId.':'.($variantId ?? '-').':'.mb_strtolower(trim($email)));
    }
}
