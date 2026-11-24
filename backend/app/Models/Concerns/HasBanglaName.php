<?php

namespace App\Models\Concerns;

use App\Support\Locale;

/** Phase 14: places and zones have an English `name` and a Bangla `bn_name`. */
trait HasBanglaName
{
    /** The name in $locale (the request's by default). */
    public function localName(?string $locale = null): string
    {
        return Locale::isBangla($locale) && filled($this->bn_name) ? $this->bn_name : $this->name;
    }
}
