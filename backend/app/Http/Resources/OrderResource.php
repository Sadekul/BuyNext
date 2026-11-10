<?php

namespace App\Http\Resources;

use App\Models\Order;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An order as its customer (or a guest with the number and email) sees it.
 * History leaves out who on staff did what, and notes the customer wasn't
 * told about (those are internal).
 *
 * @mixin Order
 */
class OrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'number' => $this->number,
            'status' => $this->status,
            'payment_status' => $this->payment_status,
            'payment_method' => $this->payment_method,
            'shipping_method' => ['id' => $this->shipping_method, 'label' => $this->shipping_label, 'eta' => $this->shipping_eta],
            'email' => $this->email,
            'phone' => $this->phone,
            'shipping_address' => $this->shipping_address,
            'billing_address' => $this->billing_address,
            'coupon_code' => $this->coupon_code,
            'items' => $this->items->map(fn ($item) => [
                'product_id' => $item->product_id,
                'sku' => $item->sku,
                'name' => $item->name,
                'thumbnail_url' => $item->thumbnail_url,
                'price' => $item->unit_price,
                'discount_percent' => (float) $item->discount_percent,
                'sale_price' => $item->sale_price,
                'quantity' => $item->quantity,
                'line_total' => $item->line_total,
            ])->values(),
            'totals' => [
                'item_count' => $this->itemCount(),
                'subtotal' => $this->subtotal,
                'discount' => $this->discount_total,
                'shipping' => $this->shipping_total,
                'tax' => $this->tax_total,
                'total' => $this->grand_total,
            ],
            'placed_at' => $this->placed_at?->toIso8601ZuluString(),
            'history' => $this->whenLoaded('history', fn () => $this->history->map(fn ($entry) => $this->historyEntry($entry))->values()),
        ];
    }

    protected function historyEntry($entry): array
    {
        return [
            'status' => $entry->status,
            'payment_status' => $entry->payment_status,
            'note' => $entry->customer_notified ? $entry->note : null,
            'created_at' => $entry->created_at?->toIso8601ZuluString(),
        ];
    }
}
