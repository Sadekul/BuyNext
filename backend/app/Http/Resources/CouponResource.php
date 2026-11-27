<?php

namespace App\Http\Resources;

use App\Models\Coupon;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A coupon as shop staff see it: every column, plus `status` (active,
 * inactive, scheduled, expired, used_up - see Coupon::status()).
 *
 * @mixin Coupon
 */
class CouponResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'description' => $this->description,
            'type' => $this->type,
            'value' => $this->value,
            'min_subtotal' => $this->min_subtotal,
            'starts_at' => $this->starts_at?->toIso8601ZuluString(),
            'ends_at' => $this->ends_at?->toIso8601ZuluString(),
            'usage_limit' => $this->usage_limit,
            'usage_limit_per_customer' => $this->usage_limit_per_customer,
            'times_used' => $this->times_used,
            'is_active' => $this->is_active,
            // Phase 7: cart price rule conditions and actions (code is null for automatic rules).
            'auto_apply' => $this->auto_apply,
            'customer_group_ids' => array_map('intval', $this->customer_group_ids ?? []),
            'applies_to' => $this->applies_to ?? 'all',
            'category_ids' => array_map('intval', $this->category_ids ?? []),
            'product_ids' => array_map('intval', $this->product_ids ?? []),
            'free_shipping' => $this->free_shipping,
            'buy_quantity' => $this->buy_quantity,
            'get_quantity' => $this->get_quantity,
            // Phase 19: staff | welcome (a personal welcome code, issued to one email address), and "first order only".
            'source' => $this->source ?? 'staff',
            'issued_to_email' => $this->issued_to_email,
            'first_order_only' => (bool) $this->first_order_only,
            'status' => $this->status(),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
