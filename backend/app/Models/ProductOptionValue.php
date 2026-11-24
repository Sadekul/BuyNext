<?php

namespace App\Models;

use App\Support\Locale;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/** One value of a product option ("M" of "Size"). */
#[Fillable(['option_id', 'value', 'swatch', 'position', 'translations'])] // phase 13: translations { bn: { value } }; phase 16: swatch (#RRGGBB)
class ProductOptionValue extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return ['translations' => 'array', 'position' => 'integer', 'option_id' => 'integer'];
    }

    /** Phase 16: a language-independent code for URLs: the slug of the English value ("blue", "128-gb"), else "value-{id}". */
    public function code(): string
    {
        return Str::slug((string) $this->value) ?: 'value-'.$this->id;
    }

    public function option(): BelongsTo
    {
        return $this->belongsTo(ProductOption::class, 'option_id');
    }

    /** Phase 13: the value in $locale (the current one by default), else the base (English) value. */
    public function translatedValue(?string $locale = null): string
    {
        $text = $this->translations[$locale ?? Locale::current()]['value'] ?? null;

        return is_string($text) && trim($text) !== '' ? $text : (string) $this->value;
    }

    /** Phase 13: { bn: text|null } for the admin. */
    public function translationsForAdmin(): array
    {
        return ['bn' => ['value' => $this->translations['bn']['value'] ?? null]];
    }
}
