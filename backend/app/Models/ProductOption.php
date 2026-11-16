<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** An option of a configurable product ("Size"), with its values ("S", "M", "L"). */
#[Fillable(['product_id', 'name', 'position'])]
class ProductOption extends Model
{
    public const MAX_PER_PRODUCT = 3;

    public const MAX_VALUES = 20;

    public $timestamps = false;

    protected function casts(): array
    {
        return ['position' => 'integer'];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function values(): HasMany
    {
        return $this->hasMany(ProductOptionValue::class, 'option_id')->orderBy('position')->orderBy('id');
    }
}
