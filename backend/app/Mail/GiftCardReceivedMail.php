<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\GiftCard;
use App\Services\GiftCards;
use App\Support\EmailBlocks;
use App\Support\Locale;
use Illuminate\Mail\Mailable;

/**
 * Phase 10 (part B): "You received a gift card": the code goes to the
 * recipient (template gift_card_received). The code is only in this email:
 * the database keeps its hash.
 */
class GiftCardReceivedMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public GiftCard $card, public string $code, public ?string $senderName = null)
    {
        // Phase 13: the recipient's language isn't known: the language of the order that bought it, else the store default.
        $order = $card->purchaserOrderItem?->order;
        $this->locale($order ? Locale::forOrder($order) : Locale::storeDefault());
    }

    /** Phase 12: the order's currency. */
    protected function templateCurrency(): ?string
    {
        return $this->card->currency;
    }

    protected function templateKey(): string
    {
        return 'gift_card_received';
    }

    protected function templateValues(): array
    {
        $shop = (string) config('buynest.storefront_url');

        return [
            'recipient_name' => $this->card->recipient_name ?: __('there'),
            'sender_name' => $this->senderName ?: self::storeName(),
            'amount' => $this->card->initial_balance,
            'code' => GiftCards::format($this->code),
            'message' => $this->card->message ? EmailBlocks::paragraph('“'.$this->card->message.'”') : '',
            'expires' => $this->card->expires_at ? __('It can be used until :date.', ['date' => Locale::isBangla() ? Locale::date($this->card->expires_at) : $this->card->expires_at->format('F j, Y')]) : __('It doesn’t expire.'),
            'shop_url' => $shop,
            'button' => EmailBlocks::button($shop, __('Start shopping')),
        ];
    }
}
