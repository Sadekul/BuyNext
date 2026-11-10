<?php

namespace App\Http\Resources;

use App\Models\Shipment;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A shipment with its tracking link. Customers get the same shape, but never
 * the staff member's name, and the note only if they were told about it.
 *
 * @mixin Shipment
 */
class ShipmentResource extends JsonResource
{
    public bool $forCustomer = false;

    public function forCustomer(bool $forCustomer = true): static
    {
        $this->forCustomer = $forCustomer;

        return $this;
    }

    public function toArray(Request $request): array
    {
        return [
            'number' => $this->number,
            'order_number' => $this->order?->number,
            'carrier' => $this->carrier,
            'carrier_label' => $this->carrierLabel(),
            'tracking_number' => $this->tracking_number,
            'tracking_url' => $this->trackingUrl(),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'admin_name' => $this->forCustomer ? null : $this->admin?->name,
            'note' => $this->forCustomer && ! $this->customer_notified ? null : $this->note,
        ];
    }
}
