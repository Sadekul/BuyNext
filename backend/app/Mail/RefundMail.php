<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\CreditMemo;
use App\Support\EmailBlocks;
use Illuminate\Mail\Mailable;

/** "Refund for order BN-…": what was refunded (items, shipping, adjustment) (template credit_memo). */
class RefundMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public CreditMemo $memo) {}

    /** Phase 12: the order's currency. */
    protected function templateCurrency(): ?string
    {
        return $this->memo->order?->currencyCode();
    }

    protected function templateKey(): string
    {
        return 'credit_memo';
    }

    protected function templateValues(): array
    {
        $memo = $this->memo;
        $order = $memo->order;
        $totals = [];
        if ((float) $memo->shipping_refund > 0) {
            $totals[] = ['Shipping', $this->money($memo->shipping_refund)];
        }
        if ((float) $memo->adjustment != 0) {
            $totals[] = ['Adjustment', $this->money($memo->adjustment)];
        }
        $totals[] = ['Refund total', $this->money($memo->total), true];

        return [
            'customer_first_name' => $order->shipping_address['first_name'] ?? 'there',
            'order_number' => $order->number,
            'credit_memo_number' => $memo->number,
            'refund_total' => $memo->total,
            'payment_method' => config("buynest.store.payment_methods.{$order->payment_method}")
                ?? config("buynest.store.admin_payment_methods.{$order->payment_method}", match ($order->payment_method) {
                    'gift_card' => 'Gift card', 'reward_points' => 'Reward points', default => $order->payment_method, // phase 11: reward points
                })
                // Phase 10 (part B): what went back to the gift card first.
                .((float) $memo->gift_card_refund > 0 ? '; $'.$memo->gift_card_refund.' back to your gift card' : ''),
            'items_table' => EmailBlocks::itemsTable(
                $memo->items->map(fn ($item) => ["{$item->orderItem->displayName()} × {$item->quantity}", $this->money($item->amount)])->all(),
                $totals,
            ),
            'note' => EmailBlocks::note($memo->note, self::storeName()),
        ];
    }
}
