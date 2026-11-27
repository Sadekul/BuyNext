<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Phase 19: one welcome code given to one email address (unique, lower
 * case). The row is the "one per email, ever" guard: it stays when the
 * coupon or the customer is deleted (their ids become null).
 */
#[Fillable(['email', 'coupon_id', 'customer_id', 'trigger'])]
class WelcomeCouponGrant extends Model
{
    public const UPDATED_AT = null;

    public const TRIGGERS = ['signup', 'newsletter'];

    public function coupon(): BelongsTo
    {
        return $this->belongsTo(Coupon::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }
}
