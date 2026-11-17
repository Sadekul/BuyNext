<?php

namespace App\Http\Resources;

use App\Models\CreditMemo;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A credit memo (refund) as shop staff see it. Items carry the order item's
 * snapshot name and sku. adjustment may be negative (a fee kept).
 *
 * @mixin CreditMemo
 */
class CreditMemoResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'number' => $this->number,
            'order_number' => $this->order?->number,
            'return_number' => $this->return_id ? $this->orderReturn?->number : null, // phase 6
            'items' => $this->items->map(fn ($item) => [
                'order_item_id' => $item->order_item_id,
                'name' => $item->orderItem?->name,
                'variant_label' => $item->orderItem?->variant_label,
                'sku' => $item->orderItem?->sku,
                'quantity' => $item->quantity,
                'amount' => $item->amount,
            ])->values(),
            'subtotal' => $this->subtotal,
            'shipping_refund' => $this->shipping_refund,
            'adjustment' => $this->adjustment,
            'total' => $this->total,
            'refund_reference' => $this->refund_reference, // phase 8: the Stripe refund id (null: refunded by hand)
            'restocked' => $this->restocked,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'admin_name' => $this->admin?->name,
            'note' => $this->note,
        ];
    }
}
