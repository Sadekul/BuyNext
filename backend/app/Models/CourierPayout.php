<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Phase 21: a payment a courier (Steadfast, Pathao, ...) made to the shop:
 * the cash it collected on delivery minus its fees. Staff record each one,
 * so the cash report can say how much is still with the courier.
 * fees: what the courier says it kept (for couriers that don't report a fee
 * per parcel; null = not given). received_on is a date in the store time zone.
 * A mistake is deleted (soft delete), never edited away silently: every
 * change is in the audit log.
 */
#[Fillable(['carrier', 'amount', 'fees', 'currency', 'received_on', 'reference', 'note', 'admin_id'])]
class CourierPayout extends Model
{
    use SoftDeletes;

    protected function casts(): array
    {
        return ['amount' => 'decimal:2', 'fees' => 'decimal:2', 'received_on' => 'date:Y-m-d'];
    }

    public function admin(): BelongsTo
    {
        return $this->belongsTo(Admin::class);
    }

    public function carrierLabel(): string
    {
        return Shipment::CARRIERS[$this->carrier][0] ?? ucfirst($this->carrier);
    }
}
