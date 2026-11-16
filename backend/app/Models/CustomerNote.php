<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A staff note about a customer. Never shown to the customer. */
#[Fillable(['customer_id', 'admin_id', 'body'])]
class CustomerNote extends Model
{
    public const UPDATED_AT = null;

    public function admin(): BelongsTo
    {
        return $this->belongsTo(Admin::class);
    }

    public function toApiArray(): array
    {
        return [
            'id' => $this->id,
            'body' => $this->body,
            'admin' => $this->admin ? ['id' => $this->admin->id, 'name' => $this->admin->name] : null,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}
