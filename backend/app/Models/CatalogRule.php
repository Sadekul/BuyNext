<?php

namespace App\Models;

use App\Services\CatalogRules;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * A catalog price rule (Magento's Marketing → Catalog price rules): an
 * automatic sale price for some shoppers (customer groups), categories (and
 * their subcategories), or products. CatalogRules does the matching and the
 * math from a cached copy of the active rules; every save or delete clears it.
 */
#[Fillable([
    'name', 'description', 'is_active', 'starts_at', 'ends_at', 'customer_group_ids', 'category_ids', 'product_ids',
    'action', 'amount', 'priority', 'stop_further',
])]
class CatalogRule extends Model
{
    public const ACTIONS = ['percent', 'fixed'];

    public const STATUSES = ['active', 'inactive', 'scheduled', 'expired'];

    protected $attributes = ['customer_group_ids' => '[]', 'category_ids' => '[]', 'product_ids' => '[]'];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
            'customer_group_ids' => 'array',
            'category_ids' => 'array',
            'product_ids' => 'array',
            'amount' => 'decimal:2',
            'priority' => 'integer',
            'stop_further' => 'boolean',
        ];
    }

    protected static function booted(): void
    {
        static::saved(fn () => app(CatalogRules::class)->flush());
        static::deleted(fn () => app(CatalogRules::class)->flush());
    }

    /** inactive, scheduled, expired, or active (the first that applies). */
    public function status(): string
    {
        return match (true) {
            ! $this->is_active => 'inactive',
            $this->starts_at && $this->starts_at->isFuture() => 'scheduled',
            $this->ends_at && $this->ends_at->isPast() => 'expired',
            default => 'active',
        };
    }

    /** The same rules as status(), in SQL, for ?status= on the admin list. */
    public function scopeWithStatus(Builder $query, string $status): void
    {
        $now = now();
        $scheduled = fn ($q) => $q->whereNotNull('starts_at')->where('starts_at', '>', $now);
        $expired = fn ($q) => $q->whereNotNull('ends_at')->where('ends_at', '<=', $now);

        match ($status) {
            'inactive' => $query->where('is_active', false),
            'scheduled' => $query->where('is_active', true)->where($scheduled),
            'expired' => $query->where('is_active', true)->whereNot($scheduled)->where($expired),
            default => $query->where('is_active', true)->whereNot($scheduled)->whereNot($expired),
        };
    }

    public function toAdminArray(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'is_active' => $this->is_active,
            'status' => $this->status(),
            'starts_at' => $this->starts_at?->toIso8601ZuluString(),
            'ends_at' => $this->ends_at?->toIso8601ZuluString(),
            'customer_group_ids' => array_map('intval', $this->customer_group_ids ?? []),
            'category_ids' => array_map('intval', $this->category_ids ?? []),
            'product_ids' => array_map('intval', $this->product_ids ?? []),
            'action' => $this->action,
            'amount' => $this->amount,
            'priority' => $this->priority,
            'stop_further' => $this->stop_further,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
