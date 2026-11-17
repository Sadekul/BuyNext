<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Phase 9 (part B): one database backup attempt (see App\Services\Backups). */
class BackupRun extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['size_bytes' => 'integer', 'started_at' => 'datetime', 'finished_at' => 'datetime'];
    }

    public function admin(): BelongsTo
    {
        return $this->belongsTo(Admin::class);
    }

    /** { id, status, trigger, file_name, size_bytes, error, started_at, finished_at, admin: { id, name } | null } */
    public function toItem(): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'trigger' => $this->trigger,
            'file_name' => $this->file_name,
            'size_bytes' => $this->size_bytes,
            'error' => $this->error,
            'started_at' => $this->started_at?->toIso8601ZuluString(),
            'finished_at' => $this->finished_at?->toIso8601ZuluString(),
            'admin' => $this->admin ? ['id' => $this->admin->id, 'name' => $this->admin->name] : null,
        ];
    }
}
