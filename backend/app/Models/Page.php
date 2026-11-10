<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/** A content page (About, Shipping and returns, ...). The body is sanitized HTML (App\Services\HtmlSanitizer). */
#[Fillable(['slug', 'title', 'body', 'meta_title', 'meta_description', 'is_published'])]
class Page extends Model
{
    public const SLUG_PATTERN = '/^[a-z0-9]+(?:-[a-z0-9]+)*$/';

    protected function casts(): array
    {
        return ['is_published' => 'boolean'];
    }
}
