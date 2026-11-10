<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One audit log entry: who did what, to what, and which fields changed. Written by App\Services\Audit. */
#[Table('audit_log')]
#[Fillable(['admin_id', 'action', 'subject_type', 'subject_id', 'summary', 'changes', 'ip'])]
class AuditLog extends Model
{
    public const UPDATED_AT = null; // entries are never changed

    protected function casts(): array
    {
        return [
            'changes' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function admin(): BelongsTo
    {
        return $this->belongsTo(Admin::class);
    }
}
