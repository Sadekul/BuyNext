<?php

namespace App\Http\Resources;

use App\Models\GiftCard;
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
            // Phase 6: where the order came from, and who placed an admin order.
            'source' => $this->source ?? 'storefront',
            'created_by_admin' => $this->created_by_admin_id && $this->createdBy
                ? ['id' => $this->createdBy->id, 'name' => $this->createdBy->name] : null,
            // Phase 10 (part B): gift cards bought with this order (made when it was paid).
            'gift_cards_issued' => $this->giftCardsIssued(),
            // Phase 18: the latest shipment's delivery status (the orders grid column), null before shipping.
            'delivery_status' => $this->shipments->last()?->delivery_status,
            // Phase 14: the phone confirmation (logs on the detail answer).
            'confirmation' => [
                'status' => $this->confirmation_status,
                'attempts' => (int) $this->confirmation_attempts,
                'confirmed_at' => $this->confirmed_at?->toIso8601ZuluString(),
                ...($this->relationLoaded('confirmationLogs') ? ['logs' => $this->confirmationLogs->map->toApi()->values()] : []),
            ],
            // Phase 20: the texts sent to the customer about this order (id: for the order page's Retry).
            'sms' => $this->smsMessages->map(fn ($message) => [
                'id' => $message->id,
                'event' => $message->event,
                'status' => $message->status,
                'to' => $message->to,
                'sent_at' => $message->sent_at?->toIso8601ZuluString(),
                'error' => $message->error,
            ])->values(),
        ];
    }

    private function giftCardsIssued(): array
    {
        $ids = $this->items->filter(fn ($item) => $item->gift_card !== null)->pluck('id');
        if ($ids->isEmpty()) {
            return [];
        }

        return GiftCard::whereIn('purchaser_order_item_id', $ids)->orderBy('id')->get()->map(fn (GiftCard $card) => [
            'id' => $card->id,
            'last4' => $card->last4,
            'amount' => $card->initial_balance,
            'recipient_email' => $card->recipient_email,
            'status' => $card->effectiveStatus(),
        ])->all();
    }

    /** Staff see who created each document, its note, and the full credit memos. */
    protected function documents(Request $request): array
    {
        return [
            'invoices' => $this->invoices->map(fn ($invoice) => [
                'number' => $invoice->number,
                'amount' => $invoice->amount,
                'created_at' => $invoice->created_at?->toIso8601ZuluString(),
                'admin_name' => $invoice->admin?->name,
                'note' => $invoice->note,
            ])->values(),
            'shipments' => $this->shipments->map(fn ($shipment) => (new ShipmentResource($shipment->setRelation('order', $this->resource)))
                ->toArray($request))->values(),
            'credit_memos' => $this->creditMemos->map(fn ($memo) => (new CreditMemoResource($memo->setRelation('order', $this->resource)))
                ->toArray($request))->values(),
        ];
    }

    protected function forCustomer(): bool
    {
        return false;
    }

    protected function historyEntry($entry): array
    {
        return [
            'status' => $entry->status,
            'payment_status' => $entry->payment_status,
            'note' => $entry->note,
            'admin_id' => $entry->admin_id,
            // Phase 18: a system actor ("Steadfast") on steps a courier reported.
            'admin_name' => $entry->admin?->name ?? $entry->actor,
            'customer_notified' => $entry->customer_notified,
            'created_at' => $entry->created_at?->toIso8601ZuluString(),
        ];
    }
}
