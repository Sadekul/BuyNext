<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Phase 14: a district or an area (one of the two) in a delivery zone. */
#[Fillable(['zone_id', 'district_id', 'area_id'])]
class DeliveryZonePlace extends Model
{
    protected function casts(): array
    {
        return ['district_id' => 'integer', 'area_id' => 'integer'];
    }

    public function zone(): BelongsTo
    {
        return $this->belongsTo(DeliveryZone::class, 'zone_id');
    }
}
