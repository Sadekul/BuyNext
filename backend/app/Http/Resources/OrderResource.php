<?php

namespace App\Http\Resources;

use App\Models\Order;
use App\Services\Pricing;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An order as its customer (or a guest with the number and email) sees it.
 * History leaves out who on staff did what, and notes the customer wasn't
 * told about (those are internal). Includes the order's invoices,
 * shipments (with tracking links), and credit memos.
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
            'items' => self::itemsOf($this->resource),
            'totals' => self::totalsOf($this->resource),
            'placed_at' => $this->placed_at?->toIso8601ZuluString(),
            'history' => $this->whenLoaded('history', fn () => $this->history->map(fn ($entry) => $this->historyEntry($entry))->values()),
            // Phase 3 documents (Order::DOCUMENTS eager-loads them).
            ...$this->documents($request),
        ];
    }

    /** Customers: invoice and refund summaries, and shipments with tracking. */
    protected function documents(Request $request): array
    {
        return [
            'invoices' => $this->invoices->map(fn ($invoice) => [
                'number' => $invoice->number,
                'amount' => $invoice->amount,
                'created_at' => $invoice->created_at?->toIso8601ZuluString(),
            ])->values(),
            'shipments' => $this->shipments->map(fn ($shipment) => (new ShipmentResource($shipment->setRelation('order', $this->resource)))
                ->forCustomer($this->forCustomer())->toArray($request))->values(),
            'credit_memos' => $this->creditMemos->map(fn ($memo) => [
                'number' => $memo->number,
                'total' => $memo->total,
                'created_at' => $memo->created_at?->toIso8601ZuluString(),
            ])->values(),
        ];
    }

    protected function forCustomer(): bool
    {
        return true;
    }

    /** The item snapshots (also on invoices). */
    public static function itemsOf(Order $order): array
    {
        return $order->items->map(fn ($item) => [
            'product_id' => $item->product_id,
            'variant_id' => $item->variant_id,
            'sku' => $item->sku,
            'name' => $item->name,
            'variant_label' => $item->variant_label,
            'thumbnail_url' => $item->thumbnail_url,
            'price' => $item->unit_price,
            'discount_percent' => (float) $item->discount_percent,
            'sale_price' => $item->sale_price,
            'quantity' => $item->quantity,
            'line_total' => $item->line_total,
        ])->values()->all();
    }

    /** The order totals, plus what was paid (invoices) and refunded (credit memos). */
    public static function totalsOf(Order $order): array
    {
        return [
            'item_count' => $order->itemCount(),
            'subtotal' => $order->subtotal,
            'discount' => $order->discount_total,
            'shipping' => $order->shipping_total,
            'tax' => $order->tax_total,
            'total' => $order->grand_total,
            'paid' => Pricing::format($order->paidCents()),
            'refunded' => Pricing::format($order->refundedCents()),
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
