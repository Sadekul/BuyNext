<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Phase 7: a saved customization of one email (the defaults are in App\Support\EmailTemplateCatalog). */
#[Fillable(['key', 'locale', 'subject', 'body', 'is_customized', 'updated_by_admin_id'])]
class EmailTemplate extends Model
{
    protected function casts(): array
    {
        return ['is_customized' => 'boolean'];
    }

    public function updatedBy(): BelongsTo
    {
        return $this->belongsTo(Admin::class, 'updated_by_admin_id');
    }
}
