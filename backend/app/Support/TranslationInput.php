<?php

namespace App\Support;

use App\Services\HtmlSanitizer;
use Illuminate\Database\Eloquent\Model;

/**
 * Phase 13: the admin's `translations: { bn: { field: text|null } }` input on
 * products, categories and pages (models using HasTranslations). A field
 * left out is unchanged, null/"" clears it (the store then shows English).
 */
final class TranslationInput
{
    /**
     * Validation rules. $fields: field => max length (null = long HTML, sanitized).
     */
    public static function rules(array $fields): array
    {
        $rules = [
            'translations' => ['sometimes', 'array:bn'],
            'translations.bn' => ['sometimes', 'nullable', 'array:'.implode(',', array_keys($fields))],
        ];
        foreach ($fields as $field => $max) {
            $rules["translations.bn.{$field}"] = ['sometimes', 'nullable', 'string', 'max:'.($max ?? HtmlSanitizer::MAX_LENGTH)];
        }

        return $rules;
    }

    /**
     * Saves the validated translations on $model. $html: fields cleaned by the sanitizer.
     * Returns the names of the Bangla fields given (for the audit log), [] when none.
     */
    public static function save(Model $model, array $data, array $html = []): array
    {
        $fields = $data['translations']['bn'] ?? null;
        if (! is_array($fields) || $fields === []) {
            return [];
        }
        foreach ($html as $field) {
            if (is_string($fields[$field] ?? null) && trim($fields[$field]) !== '') {
                $fields[$field] = app(HtmlSanitizer::class)->clean($fields[$field]);
            }
        }

        return $model->saveTranslation('bn', $fields) ? array_keys($fields) : [];
    }

    /** Takes `translations` out of validated data (the base columns are filled with the rest). */
    public static function strip(array $data): array
    {
        unset($data['translations']);

        return $data;
    }
}
