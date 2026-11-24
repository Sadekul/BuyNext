<?php

namespace App\Models;

use App\Models\Concerns\HasBanglaName;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Phase 14: a delivery zone (Inside Dhaka, Dhaka suburbs, Outside Dhaka):
 * areas and districts in it (DeliveryZonePlace); one zone may be the
 * fallback for every other Bangladesh place. Prices are shipping table rates
 * with its code (shipping_rates.zone_code).
 */
#[Fillable(['code', 'name', 'bn_name', 'position', 'is_active', 'is_fallback'])]
class DeliveryZone extends Model
{
    use HasBanglaName;

    protected function casts(): array
    {
        return ['position' => 'integer', 'is_active' => 'boolean', 'is_fallback' => 'boolean'];
    }

    public function places(): HasMany
    {
        return $this->hasMany(DeliveryZonePlace::class, 'zone_id');
    }

    /** { code, name (request language), name_en, name_bn }: how the cart and orders show it. */
    public function summary(): array
    {
        return ['code' => $this->code, 'name' => $this->localName(), 'name_en' => $this->name, 'name_bn' => $this->bn_name];
    }
}
