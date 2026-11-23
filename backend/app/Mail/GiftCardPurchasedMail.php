<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\GiftCard;
use App\Models\Order;
use App\Support\Locale;
use Illuminate\Mail\Mailable;

/**
 * Phase 10 (part B): the buyer's copy when a gift card they bought was sent
 * (template gift_card_purchased). Never contains the code.
 */
class GiftCardPurchasedMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public Order $order, public GiftCard $card)
    {
        $this->locale(Locale::forOrder($order)); // phase 13
    }

    /** Phase 12: the order's currency. */
    protected function templateCurrency(): ?string
    {
        return $this->card->currency;
    }

    protected function templateKey(): string
    {
        return 'gift_card_purchased';
    }

    protected function templateValues(): array
    {
        return [
            'customer_first_name' => $this->order->billing_address['first_name'] ?? $this->order->shipping_address['first_name'] ?? __('there'),
            'order_number' => $this->order->number,
            'recipient_name' => $this->card->recipient_name ?: (string) $this->card->recipient_email,
            'recipient_email' => (string) $this->card->recipient_email,
            'amount' => $this->card->initial_balance,
            'last4' => $this->card->last4,
        ];
    }
}
