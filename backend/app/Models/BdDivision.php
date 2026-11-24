<?php

namespace App\Models;

use App\Models\Concerns\HasBanglaName;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Phase 14: one of Bangladesh's 8 divisions (BangladeshPlacesSeeder). */
class BdDivision extends Model
{
    use HasBanglaName;

    public $timestamps = false;

    public $incrementing = false;

    protected $guarded = [];

    public function districts(): HasMany
    {
        return $this->hasMany(BdDistrict::class, 'division_id');
    }
}
