<?php

namespace App\Http\Resources;

use App\Models\Invoice;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An invoice: what was paid, with the order's billing address, item
 * snapshots, and totals (enough for the printable invoice page). Customers
 * never see the staff member's name, and the note only if they were told.
 *
 * @mixin Invoice
 */
class InvoiceResource extends JsonResource
{
    public bool $forCustomer = false;

    public function forCustomer(bool $forCustomer = true): static
    {
        $this->forCustomer = $forCustomer;

        return $this;
    }

    public function toArray(Request $request): array
    {
        $order = $this->order;

        return [
            'number' => $this->number,
            'order_number' => $order->number,
            'amount' => $this->amount,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'admin_name' => $this->forCustomer ? null : $this->admin?->name,
            'note' => $this->forCustomer && ! $this->customer_notified ? null : $this->note,
            'billing_address' => $order->billing_address,
            'items' => OrderResource::itemsOf($order),
            'totals' => OrderResource::totalsOf($order),
            'gift_card' => OrderResource::giftCardOf($order), // phase 10 (part B)
        ];
    }
}
