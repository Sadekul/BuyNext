<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An admin account. withPermissions() (sign-in and GET /me) adds the keys the
 * admin's role grants, so the admin app can hide what they can't do.
 */
class AdminResource extends JsonResource
{
    protected bool $permissions = false;

    public function withPermissions(): static
    {
        $this->permissions = true;

        return $this;
    }

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'is_active' => $this->is_active,
            'role' => $this->role ? ['id' => $this->role->id, 'name' => $this->role->name] : null,
            'permissions' => $this->when($this->permissions, fn () => $this->resource->permissions()),
            'last_login_at' => $this->last_login_at?->toIso8601ZuluString(),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}
