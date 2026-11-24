<?php

namespace App\Models;

use App\Models\Concerns\HasBanglaName;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Phase 14: an upazila, or a metro thana of a city corporation (ids from 1001, see BangladeshPlacesSeeder). */
class BdArea extends Model
{
    use HasBanglaName;

    public $timestamps = false;

    public $incrementing = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['district_id' => 'integer', 'postcodes' => 'array'];
    }

    public function district(): BelongsTo
    {
        return $this->belongsTo(BdDistrict::class, 'district_id');
    }
}
