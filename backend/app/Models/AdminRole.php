<?php

namespace App\Models;

use App\Support\Permissions;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * An admin role: a named list of permission keys (App\Support\Permissions).
 * System roles (Owner) can't be edited or deleted and always have every key.
 */
#[Fillable(['name', 'description', 'permissions'])]
class AdminRole extends Model
{
    public const OWNER = 'Owner';

    protected function casts(): array
    {
        return [
            'permissions' => 'array',
            'is_system' => 'boolean',
        ];
    }

    public function admins(): HasMany
    {
        return $this->hasMany(Admin::class, 'role_id');
    }

    public static function owner(): ?self
    {
        return self::where('name', self::OWNER)->where('is_system', true)->first();
    }

    public function isOwner(): bool
    {
        return $this->is_system && $this->name === self::OWNER;
    }

    /** The keys this role grants, in catalog order. Owner: all of them, so new keys need no migration. */
    public function permissionKeys(): array
    {
        if ($this->isOwner()) {
            return Permissions::all();
        }
        $granted = $this->permissions ?? [];

        // Catalog order, and unknown (removed) keys are ignored.
        return array_values(array_filter(Permissions::all(), fn ($key) => in_array($key, $granted, true)));
    }
}
