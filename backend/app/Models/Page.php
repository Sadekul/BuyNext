<?php

namespace App\Models;

use App\Models\Concerns\HasTranslations;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/** A content page (About, Shipping and returns, ...). The body is sanitized HTML (App\Services\HtmlSanitizer). */
#[Fillable(['slug', 'title', 'body', 'meta_title', 'meta_description', 'is_published'])]
class Page extends Model
{
    use HasTranslations;

    /** Phase 13: the fields with a Bangla version (product_translations etc.). */
    public const TRANSLATABLE = ['title', 'body', 'meta_title', 'meta_description'];

    protected static function translationModel(): string
    {
        return PageTranslation::class;
    }

    public const SLUG_PATTERN = '/^[a-z0-9]+(?:-[a-z0-9]+)*$/';

    protected function casts(): array
    {
        return ['is_published' => 'boolean'];
    }
}
