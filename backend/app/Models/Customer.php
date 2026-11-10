<?php

namespace App\Models;

use Database\Factories\CustomerFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\MassPrunable;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

/**
 * A storefront customer. Signs in only on the storefront; admin routes refuse
 * customer tokens (EnsureTokenKind).
 */
#[Fillable(['first_name', 'last_name', 'email', 'phone', 'password'])]
#[Hidden(['password'])]
class Customer extends Authenticatable
{
    /** @use HasFactory<CustomerFactory> */
    use HasApiTokens, HasFactory, MassPrunable;

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'is_active' => 'boolean',
            'password' => 'hashed',
        ];
    }

    public function hasVerifiedEmail(): bool
    {
        return $this->email_verified_at !== null;
    }

    /** Sign-ups that never verified their email, deleted by `model:prune` (scheduled daily). */
    public function prunable(): Builder
    {
        return static::whereNull('email_verified_at')
            ->where('created_at', '<', now()->subDays(config('buynest.prune_unverified_after_days')));
    }
}
