<?php

namespace App\Models;

use App\Support\Locale;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One value of a product option ("M" of "Size"). */
#[Fillable(['option_id', 'value', 'position', 'translations'])] // phase 13: translations { bn: { value } }
class ProductOptionValue extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return ['translations' => 'array', 'position' => 'integer', 'option_id' => 'integer'];
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
