<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;

/**
 * A shipment in the admin's Shipments list (phase 6): ShipmentResource plus
 * an order summary; ->detail() adds the order's address and the items
 * (one shipment ships every item of the order).
 */
class AdminShipmentResource extends ShipmentResource
{
    private bool $detail = false;

    public function detail(bool $detail = true): static
    {
        $this->detail = $detail;

        return $this;
    }

    public function toArray(Request $request): array
    {
        $order = $this->order;
        $address = $order->shipping_address ?? [];

        return [
            ...parent::toArray($request),
            'item_count' => $order->itemCount(),
            'order' => [
                'number' => $order->number,
                'status' => $order->status,
                'payment_status' => $order->payment_status,
                'email' => $order->email,
                'customer_name' => trim(($address['first_name'] ?? '').' '.($address['last_name'] ?? '')),
                'ship_to' => trim(($address['city'] ?? '').', '.($address['country'] ?? ''), ', '),
                'placed_at' => $order->placed_at?->toIso8601ZuluString(),
                ...($this->detail ? [
                    'shipping_method' => ['id' => $order->shipping_method, 'label' => $order->shipping_label],
                    'shipping_address' => $order->shipping_address,
                    'phone' => $order->phone,
                ] : []),
            ],
            ...($this->detail ? ['items' => $order->items->map(fn ($item) => [
                'order_item_id' => $item->id,
                'sku' => $item->sku,
                'name' => $item->name,
                'variant_label' => $item->variant_label,
                'thumbnail_url' => $item->thumbnail_url,
                'quantity' => $item->quantity,
            ])->values()] : []),
        ];
    }
}
