<?php

namespace App\Models;

use App\Support\Locale;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/** An option of a configurable product ("Size"), with its values ("S", "M", "L"). */
#[Fillable(['product_id', 'name', 'type', 'position', 'translations'])] // phase 13: translations { bn: { name } }; phase 16: type
class ProductOption extends Model
{
    public const MAX_PER_PRODUCT = 3;

    public const MAX_VALUES = 20;

    /** Phase 16: "text" = buttons (Size, Storage), "color" = round colour swatches (values have a #RRGGBB swatch). */
    public const TYPES = ['text', 'color'];

    /** Phase 16: a swatch is a hex colour. */
    public const SWATCH_PATTERN = '/^#[0-9A-Fa-f]{6}$/';

    public $timestamps = false;

    protected function casts(): array
    {
        return ['translations' => 'array', 'position' => 'integer'];
    }

    /** Phase 16: "text" (also for rows saved before the column existed) or "color". */
    public function typeName(): string
    {
        return $this->type === 'color' ? 'color' : 'text';
    }

    /** Phase 16: a language-independent code for URLs: the slug of the English name ("color"), else "option-{id}". */
    public function code(): string
    {
        return Str::slug((string) $this->name) ?: 'option-'.$this->id;
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
