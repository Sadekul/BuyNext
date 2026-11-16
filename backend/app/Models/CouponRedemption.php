<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/** One use of a coupon by one order (deleted again when that order is cancelled). */
#[Fillable(['coupon_id', 'order_id', 'customer_id', 'email', 'discount'])]
class CouponRedemption extends Model
{
    public const UPDATED_AT = null;
}
