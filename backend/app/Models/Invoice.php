<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Records that an order was paid (Magento's invoice). Phase 3: one per order,
 * for the full grand total. "INV-100001" = 100000 + id.
 */
#[Fillable(['order_id', 'amount', 'admin_id', 'note', 'customer_notified'])]
class Invoice extends Model
{
    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return ['amount' => 'decimal:2', 'customer_notified' => 'boolean'];
    }

    public static function numberFor(int $id): string
    {
        return 'INV-'.(100000 + $id);
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function admin(): BelongsTo
    {
        return $this->belongsTo(Admin::class);
    }
}
