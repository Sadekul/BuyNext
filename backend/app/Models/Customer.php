<?php

namespace App\Models;

use Database\Factories\CustomerFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\MassPrunable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

/**
 * A storefront customer. Signs in only on the storefront; admin routes refuse
 * customer tokens (EnsureTokenKind).
 */
#[Fillable(['first_name', 'last_name', 'email', 'phone', 'password', 'group_id', 'locale'])] // phase 13: locale (en|bn|null)
#[Hidden(['password', 'wishlist_share_hash'])]
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
            'reward_points' => 'integer', // phase 11: the reward point balance (changed only by App\Services\RewardPoints)
            'wishlist_shared_at' => 'datetime', // phase 11
            'password' => 'hashed',
        ];
    }

    /** New accounts join the default group (General) unless one is given. */
    protected static function booted(): void
    {
        static::creating(function (Customer $customer) {
            $customer->group_id ??= CustomerGroup::general()?->id;
        });
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(CustomerGroup::class, 'group_id');
    }

    /** The customer's group, or General (a customer always has a price group). */
    public function priceGroup(): ?CustomerGroup
    {
        return $this->group ?? CustomerGroup::general();
    }

    public function addresses(): HasMany
    {
        return $this->hasMany(CustomerAddress::class)->orderBy('id');
    }

    public function notes(): HasMany
    {
        return $this->hasMany(CustomerNote::class)->orderByDesc('id');
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    /** Phase 11: the wishlist kept on the server (newest first). */
    public function wishlistItems(): HasMany
    {
        return $this->hasMany(WishlistItem::class)->orderByDesc('id');
    }

    /** Phase 11: the reward point history (newest first). */
    public function rewardTransactions(): HasMany
    {
        return $this->hasMany(RewardTransaction::class)->orderByDesc('id');
    }

    public function reviews(): HasMany
    {
        return $this->hasMany(Review::class);
    }

    public function hasVerifiedEmail(): bool
    {
        return $this->email_verified_at !== null;
    }

    /**
     * Sign-ups that never verified their email, deleted by `model:prune` (scheduled daily).
     * Phase 6: an account staff created, or one that was ever used (signed in,
     * placed an order) and is unverified only because staff changed its email,
     * is never an abandoned sign-up.
     */
    public function prunable(): Builder
    {
        return static::whereNull('email_verified_at')
            ->whereNull('created_by_admin_id')
            ->whereNull('last_login_at')
            ->whereDoesntHave('orders')
            ->where('created_at', '<', now()->subDays(config('buynest.prune_unverified_after_days')));
    }
}
