<?php

namespace App\Models;

use App\Services\Pricing;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A customer group (Magento's Customers → Customer groups). Its discount
 * applies to every line's sale price (after the product's own discount,
 * before coupons). General is the system group: new sign-ups join it and
 * guests are priced as General.
 */
#[Fillable(['name', 'code', 'discount_percent'])]
class CustomerGroup extends Model
{
    public const GENERAL = 'general';

    protected function casts(): array
    {
        return ['discount_percent' => 'decimal:2', 'is_system' => 'boolean'];
    }

    public function customers(): HasMany
    {
        return $this->hasMany(Customer::class, 'group_id');
    }

    /** The default group (new sign-ups, guests). */
    public static function general(): ?self
    {
        return self::where('code', self::GENERAL)->first();
    }

    /** The discount in hundredths of a percent (10.00% → 1000), for integer math. */
    public function discountBasisPoints(): int
    {
        return Pricing::toCents((string) $this->discount_percent);
    }

    /** { name, discount_percent } as the storefront sees it. */
    public function summary(): array
    {
        return ['name' => $this->name, 'discount_percent' => $this->discount_percent];
    }

    public function toAdminArray(?int $customersCount = null): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'code' => $this->code,
            'discount_percent' => $this->discount_percent,
            'is_system' => $this->is_system,
            'is_default' => $this->code === self::GENERAL,
            'customers_count' => $customersCount ?? $this->customers_count ?? $this->customers()->count(),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
