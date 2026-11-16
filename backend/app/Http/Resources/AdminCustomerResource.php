<?php

namespace App\Http\Resources;

use App\Models\Customer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A customer as shop staff see them in the admin list (adds status, group,
 * and activity). The full profile (GET /customers/{id}) adds more; see
 * CustomerController::profile().
 *
 * @mixin Customer
 */
class AdminCustomerResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $group = $this->relationLoaded('group') ? $this->group : $this->group()->first();

        return [
            'id' => $this->id,
            'first_name' => $this->first_name,
            'last_name' => $this->last_name,
            'email' => $this->email,
            'phone' => $this->phone,
            'email_verified_at' => $this->email_verified_at?->toIso8601ZuluString(),
            'email_verified' => $this->email_verified_at !== null,
            'is_active' => $this->is_active,
            // blocked wins over unverified (the list's status filter uses the same words).
            'status' => ! $this->is_active ? 'blocked' : ($this->email_verified_at ? 'active' : 'unverified'),
            'group' => $group ? ['id' => $group->id, 'name' => $group->name, 'code' => $group->code, 'discount_percent' => $group->discount_percent] : null,
            'orders_count' => $this->whenCounted('orders'),
            'created_by_admin' => $this->created_by_admin_id !== null,
            'last_login_at' => $this->last_login_at?->toIso8601ZuluString(),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}
