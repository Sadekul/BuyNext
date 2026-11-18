<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Phase 11: one change of a customer's reward point balance (points signed). See App\Services\RewardPoints. */
#[Fillable(['customer_id', 'points', 'balance_after', 'type', 'order_id', 'credit_memo_id', 'review_id', 'admin_id', 'note', 'unique_key'])]
class RewardTransaction extends Model
{
    public const UPDATED_AT = null;

    public const TYPES = ['earn', 'spend', 'cancel_return', 'refund_return', 'refund_reverse', 'signup', 'review', 'adjust'];

    protected function casts(): array
    {
        return [
            'points' => 'integer',
            'balance_after' => 'integer',
            'created_at' => 'datetime',
        ];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function creditMemo(): BelongsTo
    {
        return $this->belongsTo(CreditMemo::class);
    }

    public function admin(): BelongsTo
    {
        return $this->belongsTo(Admin::class);
    }
}
