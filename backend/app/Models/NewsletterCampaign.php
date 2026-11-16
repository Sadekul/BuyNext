<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Phase 7: a newsletter email (draft → sending → sent). Sent in queued batches of 100 (SendNewsletterBatch). */
#[Fillable(['subject', 'preheader', 'body', 'status', 'recipient_count', 'sent_count', 'failed_count',
    'batches_total', 'batches_done', 'created_by_admin_id', 'sent_at'])]
class NewsletterCampaign extends Model
{
    public const STATUSES = ['draft', 'sending', 'sent'];

    protected function casts(): array
    {
        return [
            'recipient_count' => 'integer',
            'sent_count' => 'integer',
            'failed_count' => 'integer',
            'batches_total' => 'integer',
            'batches_done' => 'integer',
            'sent_at' => 'datetime',
        ];
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(Admin::class, 'created_by_admin_id');
    }
}
