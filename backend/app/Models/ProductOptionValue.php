<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One value of a product option ("M" of "Size"). */
#[Fillable(['option_id', 'value', 'position'])]
class ProductOptionValue extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return ['position' => 'integer', 'option_id' => 'integer'];
    }

    public function option(): BelongsTo
    {
        return $this->belongsTo(ProductOption::class, 'option_id');
    }
}
