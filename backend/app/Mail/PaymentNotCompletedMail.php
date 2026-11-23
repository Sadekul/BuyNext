<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\Order;
use App\Support\EmailBlocks;
use App\Support\Locale;
use Illuminate\Mail\Mailable;

/**
 * Phase 8: "Payment not completed": the card order was cancelled because
 * Stripe's payment page expired unpaid (template payment_not_completed).
 */
class PaymentNotCompletedMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public Order $order)
    {
        $this->locale(Locale::forOrder($order)); // phase 13
    }

    /** Phase 12: the order's currency. */
    protected function templateCurrency(): ?string
    {
        return $this->order->currencyCode();
    }

    protected function templateKey(): string
    {
        return 'payment_not_completed';
    }

    protected function templateValues(): array
    {
        $shop = (string) config('buynest.storefront_url');

        return [
            'customer_first_name' => $this->order->shipping_address['first_name'] ?? __('there'),
            'order_number' => $this->order->number,
            'order_total' => $this->order->grand_total,
            'shop_url' => $shop,
            'button' => EmailBlocks::button($shop, __('Shop again')),
        ];
    }
}
