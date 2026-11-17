<?php

namespace App\Models;

use Database\Factories\AdminFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

/**
 * A member of shop staff. Separate from customers: own table, own sign-in, own tokens.
 * What they may do comes from their role (AdminRole). No role = no permissions.
 */
#[Fillable(['name', 'email', 'password', 'role_id'])]
#[Hidden(['password', 'two_factor_secret', 'two_factor_recovery_codes'])]
class Admin extends Authenticatable
{
    /** @use HasFactory<AdminFactory> */
    use HasApiTokens, HasFactory;

    protected function casts(): array
    {
        return [
            'last_login_at' => 'datetime',
            'is_active' => 'boolean',
            'password' => 'hashed',
            // Phase 9 (part A): the authenticator key is encrypted with APP_KEY; recovery codes are stored as hashes.
            'two_factor_secret' => 'encrypted',
            'two_factor_confirmed_at' => 'datetime',
            'two_factor_recovery_codes' => 'array',
            'two_factor_last_step' => 'integer',
        ];
    }

    /** Phase 9 (part A): two-step sign-in is on (enrolled and confirmed). */
    public function hasTwoFactor(): bool
    {
        return $this->two_factor_confirmed_at !== null && $this->two_factor_secret !== null;
    }

    public function role(): BelongsTo
    {
        return $this->belongsTo(AdminRole::class, 'role_id');
    }

    /** @return list<string> */
    public function permissions(): array
    {
        return $this->role?->permissionKeys() ?? [];
    }

    public function hasPermission(string $key): bool
    {
        return in_array($key, $this->permissions(), true);
    }

    public function isOwner(): bool
    {
        return (bool) $this->role?->isOwner();
    }
}
