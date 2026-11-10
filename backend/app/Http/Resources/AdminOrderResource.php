<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;

/** An order as shop staff see it: adds the id, the customer account, and the full history. */
class AdminOrderResource extends OrderResource
{
    public function toArray(Request $request): array
    {
        $customer = $this->customer;

        return [
            'id' => $this->id,
            ...parent::toArray($request),
            'customer' => $customer ? [
                'id' => $customer->id,
                'name' => trim("{$customer->first_name} {$customer->last_name}"),
                'email' => $customer->email,
            ] : null,
        ];
    }

    protected function historyEntry($entry): array
    {
        return [
            'status' => $entry->status,
            'payment_status' => $entry->payment_status,
            'note' => $entry->note,
            'admin_id' => $entry->admin_id,
            'admin_name' => $entry->admin?->name,
            'customer_notified' => $entry->customer_notified,
            'created_at' => $entry->created_at?->toIso8601ZuluString(),
        ];
    }
}
