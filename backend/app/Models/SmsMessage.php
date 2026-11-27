<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\MassPrunable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Phase 20: one text to a customer (or a staff test send): what it said, to
 * which number, through which provider, and how it went (queued → sent |
 * failed; a failed one can be retried up to buynest.sms.max_attempts times).
 *
 * model:prune (daily) deletes log-driver rows after 90 days (they were never
 * sent anywhere) and real providers' rows after a year.
 */
class SmsMessage extends Model
{
    use MassPrunable;

    public const STATUSES = ['queued', 'sent', 'failed'];

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'segments' => 'integer',
            'attempts' => 'integer',
            'sent_at' => 'datetime',
        ];
    }

    public function prunable(): Builder
    {
        return static::where(fn (Builder $q) => $q->where('provider', 'log')->where('created_at', '<', now()->subDays(90)))
            ->orWhere(fn (Builder $q) => $q->where('provider', '!=', 'log')->where('created_at', '<', now()->subYear()));
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function admin(): BelongsTo
    {
        return $this->belongsTo(Admin::class);
    }
}
