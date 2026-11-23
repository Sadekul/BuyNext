<?php

namespace App\Models\Concerns;

use App\Support\Locale;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Phase 13: content with versions in other languages (product_translations,
 * category_translations, page_translations). The model's own columns are the
 * base (English) text. translated('name') answers the current language's
 * text, falling back to the base text per field when the translation is
 * missing or empty. The using model defines TRANSLATABLE (its fields) and
 * translationModel() (the row class).
 *
 * @mixin Model
 */
trait HasTranslations
{
    abstract protected static function translationModel(): string;

    public function translations(): HasMany
    {
        return $this->hasMany(static::translationModel());
    }

    /** The translation row for $locale (null for English or when there is none). */
    public function translationFor(?string $locale = null): ?Model
    {
        $locale ??= Locale::current();
        if ($locale === Locale::FALLBACK || ! $this->exists) {
            return null;
        }

        return $this->translations->firstWhere('locale', $locale);
    }

    /** The translated text of $field in $locale (the current language by default), else the base text. */
    public function translated(string $field, ?string $locale = null): mixed
    {
        $text = $this->translationFor($locale)?->{$field};

        return is_string($text) && trim($text) !== '' ? $text : $this->getAttribute($field);
    }

    /** The language actually used for $field ("bn" when translated, else "en"). */
    public function translatedLocale(string $field = 'name', ?string $locale = null): string
    {
        $locale ??= Locale::current();
        $text = $this->translationFor($locale)?->{$field};

        return is_string($text) && trim($text) !== '' ? $locale : Locale::FALLBACK;
    }

    /** { field: text|null } of $locale's row, for the admin (null = falls back to the base text). */
    public function translationFields(string $locale = 'bn'): array
    {
        $row = $this->exists ? $this->translations->firstWhere('locale', $locale) : null;
        $fields = [];
        foreach (static::TRANSLATABLE as $field) {
            $value = $row?->{$field};
            $fields[$field] = is_string($value) && trim($value) !== '' ? $value : null;
        }

        return $fields;
    }

    /** Fields of TRANSLATABLE that $locale's row leaves empty (they show the base text). */
    public function missingTranslations(string $locale = 'bn'): array
    {
        return array_keys(array_filter($this->translationFields($locale), fn ($value) => $value === null));
    }

    /**
     * Saves $locale's fields ({ field: text|null }, only the keys given change).
     * Every field empty → the row is deleted. Returns true when something changed.
     */
    public function saveTranslation(string $locale, array $fields): bool
    {
        $fields = array_intersect_key($fields, array_flip(static::TRANSLATABLE));
        if ($fields === []) {
            return false;
        }
        $row = $this->translations()->firstOrNew(['locale' => $locale]);
        foreach ($fields as $field => $value) {
            $row->{$field} = is_string($value) && trim($value) !== '' ? trim($value) : null;
        }
        $empty = collect(static::TRANSLATABLE)->every(fn ($field) => ! filled($row->{$field}));
        $changed = false;
        if ($empty) {
            if ($row->exists) {
                $row->delete();
                $changed = true;
            }
        } elseif ($row->isDirty() || ! $row->exists) {
            $row->save();
            $changed = true;
        }
        $this->unsetRelation('translations');

        return $changed;
    }
}
