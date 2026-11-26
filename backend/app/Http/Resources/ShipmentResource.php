<?php

namespace App\Http\Resources;

use App\Models\Shipment;
use App\Services\Pricing;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A shipment with its tracking link. Customers get the same shape, but never
 * the staff member's name, and the note only if they were told about it.
 * Phase 18: the delivery status and the courier's timeline; staff also get
 * the courier booking (fee, cash collected, raw statuses), customers never.
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
            // Phase 18: our delivery status ("shipped" for manual shipments) and the courier's timeline.
            'delivery_status' => $this->delivery_status ?? 'shipped',
            'delivery_status_label' => Shipment::deliveryLabel($this->delivery_status),
            ...($this->forCustomer ? [] : ['courier' => $this->courier()]),
            'events' => $this->events->map(fn ($event) => [
                'delivery_status' => $event->delivery_status,
                'label' => Shipment::deliveryLabel($event->delivery_status),
                // Customers never see the courier's raw status or where we heard it.
                ...($this->forCustomer ? [] : ['courier_status' => $event->courier_status]),
                'message' => $event->message,
                ...($this->forCustomer ? [] : ['source' => $event->source]),
                'occurred_at' => $event->occurred_at?->toIso8601ZuluString(),
            ])->values()->all(),
        ];
    }

    /** Phase 18 (staff only): the courier booking, or null for a manual shipment. Money as "0.00" strings (null when unknown). */
    private function courier(): ?array
    {
        if (! $this->booked_via_api) {
            return null;
        }
        $money = fn (?int $cents) => $cents === null ? null : Pricing::format($cents);

        return [
            'key' => $this->carrier,
            'label' => $this->carrierLabel(),
            'consignment_id' => $this->courier_consignment_id,
            'tracking_code' => $this->tracking_number,
            'booked_via_api' => true,
            'courier_status' => $this->courier_status,
            'delivery_status' => $this->delivery_status,
            'delivery_status_label' => Shipment::deliveryLabel($this->delivery_status),
            'cod_amount' => $money($this->cod_amount_cents),
            'courier_fee' => $money($this->courier_fee_cents),
            'collected' => $money($this->collected_cents),
            'status_updated_at' => $this->status_updated_at?->toIso8601ZuluString(),
            'last_synced_at' => $this->last_synced_at?->toIso8601ZuluString(),
        ];
    }
}
