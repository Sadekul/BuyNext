<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/** Phase 13: one language's version of the base (English) text; an empty field falls back to the base text. */
#[Fillable(['page_id', 'locale', 'title', 'body', 'meta_title', 'meta_description'])]
class PageTranslation extends Model {}
