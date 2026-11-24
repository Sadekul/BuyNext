<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Phase 14: one phone confirmation attempt on a cash on delivery order (or a staff override to ship it unconfirmed). */
#[Fillable(['order_id', 'admin_id', 'outcome', 'note'])]
class OrderConfirmationLog extends Model
{
    public const OUTCOMES = ['confirmed', 'unreachable', 'cancelled', 'override'];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function admin(): BelongsTo
    {
        return $this->belongsTo(Admin::class);
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'outcome' => $this->outcome,
            'note' => $this->note,
            'admin_id' => $this->admin_id,
            'admin_name' => $this->admin?->name,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}
