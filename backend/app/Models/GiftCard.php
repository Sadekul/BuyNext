<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Phase 10 (part B): a gift card. The code itself is never stored: only its
 * SHA-256 hash (to find the card) and its last 4 characters (to show).
 * The balance changes only through App\Services\GiftCards, under a row lock,
 * and every change is a GiftCardTransaction.
 */
#[Fillable([
    'code_hash', 'last4', 'initial_balance', 'balance', 'currency', 'status', 'expires_at', 'purchaser_order_item_id',
    'recipient_email', 'recipient_name', 'message', 'created_by_admin_id',
])]
class GiftCard extends Model
{
    /** Stored statuses; "expired" is also shown once expires_at has passed (effectiveStatus()). */
    public const STATUSES = ['active', 'disabled', 'expired'];

    protected function casts(): array
    {
        return [
            'initial_balance' => 'decimal:2',
            'balance' => 'decimal:2',
            'expires_at' => 'datetime',
        ];
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(GiftCardTransaction::class)->orderByDesc('id');
    }

    public function purchaserOrderItem(): BelongsTo
    {
        return $this->belongsTo(OrderItem::class, 'purchaser_order_item_id');
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(Admin::class, 'created_by_admin_id');
    }

    /** active, disabled, or expired (also when the date passed but the row still says active). */
    public function effectiveStatus(): string
    {
        if ($this->status === 'active' && $this->expires_at !== null && $this->expires_at->isPast()) {
            return 'expired';
        }

        return $this->status;
    }

    public function isUsable(): bool
    {
        return $this->effectiveStatus() === 'active';
    }
}
