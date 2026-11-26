<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Phase 18: one step of a courier-booked parcel's way: our delivery_status,
 * the courier's own status, its tracking message, and where we heard it
 * (booking, webhook, sync, or staff).
 */
#[Fillable(['shipment_id', 'delivery_status', 'courier_status', 'message', 'source', 'occurred_at'])]
class ShipmentEvent extends Model
{
    public const UPDATED_AT = null;

    public const SOURCES = ['booking', 'webhook', 'sync', 'staff'];

    protected function casts(): array
    {
        return ['occurred_at' => 'datetime'];
    }

    public function shipment(): BelongsTo
    {
        return $this->belongsTo(Shipment::class);
    }
}
