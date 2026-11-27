<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One use of a coupon by one order (deleted again when that order is cancelled). */
#[Fillable(['coupon_id', 'order_id', 'customer_id', 'email', 'discount'])]
class CouponRedemption extends Model
{
    public const UPDATED_AT = null;

    /** Phase 19: the order that used the code (the welcome codes list links to it). */
    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }
}
