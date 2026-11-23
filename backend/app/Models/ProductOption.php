<?php

namespace App\Models;

use App\Support\Locale;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** An option of a configurable product ("Size"), with its values ("S", "M", "L"). */
#[Fillable(['product_id', 'name', 'position', 'translations'])] // phase 13: translations { bn: { name } }
class ProductOption extends Model
{
    public const MAX_PER_PRODUCT = 3;

    public const MAX_VALUES = 20;

    public $timestamps = false;

    protected function casts(): array
    {
        return ['translations' => 'array', 'position' => 'integer'];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function values(): HasMany
    {
        return $this->hasMany(ProductOptionValue::class, 'option_id')->orderBy('position')->orderBy('id');
    }

    /** Phase 13: the name in $locale (the current one by default), else the base (English) name. */
    public function translatedName(?string $locale = null): string
    {
        $text = $this->translations[$locale ?? Locale::current()]['name'] ?? null;

        return is_string($text) && trim($text) !== '' ? $text : (string) $this->name;
    }

    /** Phase 13: { bn: text|null } for the admin. */
    public function translationsForAdmin(): array
    {
        return ['bn' => ['name' => $this->translations['bn']['name'] ?? null]];
    }
}
