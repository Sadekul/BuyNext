<?php

namespace App\Models;

use App\Models\Concerns\HasBanglaName;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Phase 14: one of Bangladesh's 64 districts (zila). */
class BdDistrict extends Model
{
    use HasBanglaName;

    public $timestamps = false;

    public $incrementing = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['division_id' => 'integer'];
    }

    public function division(): BelongsTo
    {
        return $this->belongsTo(BdDivision::class, 'division_id');
    }

    public function areas(): HasMany
    {
        return $this->hasMany(BdArea::class, 'district_id');
    }
}
