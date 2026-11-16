<?php

namespace App\Http\Resources;

use App\Models\OrderReturn;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A return (RMA). The list shape is the summary; ->detail() adds the items,
 * the order, the refund, and (for staff) the allowed next statuses.
 * Customers see admin_note only when the change that set it emailed them,
 * never staff names or who created it.
 *
 * @mixin OrderReturn
 */
class ReturnResource extends JsonResource
{
    protected bool $forCustomer = false;

    private bool $detail = false;

    public function forCustomer(bool $forCustomer = true): static
    {
        $this->forCustomer = $forCustomer;

        return $this;
    }

    public function detail(bool $detail = true): static
    {
        $this->detail = $detail;

        return $this;
    }

    public function toArray(Request $request): array
    {
        $order = $this->order;
        $customer = $this->customer;
        $summary = [
            'number' => $this->number,
            'order_number' => $order?->number,
            'status' => $this->status,
            'reason' => $this->reason,
            'resolution' => $this->resolution,
            'items_count' => (int) $this->items->sum('quantity'),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
        if (! $this->forCustomer) {
            $summary += [
                'email' => $order?->email,
                'customer' => $customer ? ['id' => $customer->id, 'name' => trim("{$customer->first_name} {$customer->last_name}"), 'email' => $customer->email] : null,
                'created_by_admin' => $this->createdBy ? ['id' => $this->createdBy->id, 'name' => $this->createdBy->name] : null,
            ];
        }
        if (! $this->detail) {
            return $summary;
        }

        $memo = $this->creditMemo;

        return [
            ...$summary,
            'comment' => $this->comment,
            'admin_note' => $this->forCustomer && ! $this->customer_notified ? null : $this->admin_note,
            'restocked' => $this->restocked,
            'items' => $this->items->map(fn ($item) => [
                'id' => $item->id,
                'order_item_id' => $item->order_item_id,
                'product_id' => $item->orderItem?->product_id,
                'variant_id' => $item->orderItem?->variant_id,
                'sku' => $item->orderItem?->sku,
                'name' => $item->orderItem?->name,
                'variant_label' => $item->orderItem?->variant_label,
                'thumbnail_url' => $item->orderItem?->thumbnail_url,
                'quantity' => $item->quantity,
                'condition' => $item->condition,
            ])->values(),
            'order' => $order ? [
                'number' => $order->number,
                'status' => $order->status,
                'payment_status' => $order->payment_status,
                'placed_at' => $order->placed_at?->toIso8601ZuluString(),
            ] : null,
            'credit_memo' => $memo ? ['number' => $memo->number, 'total' => $memo->total, 'created_at' => $memo->created_at?->toIso8601ZuluString()] : null,
            'allowed_transitions' => $this->forCustomer ? [] : array_values(array_diff(OrderReturn::TRANSITIONS[$this->status] ?? [], ['refunded'])),
            'can_refund' => ! $this->forCustomer && $this->status === 'received',
        ];
    }
}
