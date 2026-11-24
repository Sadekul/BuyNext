<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\Order;
use App\Services\Pricing;
use App\Support\EmailBlocks;
use App\Support\Locale;
use Illuminate\Mail\Mailable;

/** Phase 14: "We've confirmed your order", sent when staff confirm a cash on delivery order by phone (template cod_confirmed). */
class CodConfirmedMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public Order $order)
    {
        $this->locale(Locale::forOrder($order));
    }

    protected function templateCurrency(): ?string
    {
        return $this->order->currencyCode();
    }

    protected function templateKey(): string
    {
        return 'cod_confirmed';
    }

    protected function templateValues(): array
    {
        $order = $this->order;

        return [
            'customer_first_name' => $order->shipping_address['first_name'] ?? __('there'),
            'order_number' => $order->number,
            'order_total' => $order->grand_total,
            'cod_amount' => Pricing::format($order->codDueCents()),
            'delivery_estimate' => $order->deliveryText() ?? Locale::digits(__((string) $order->shipping_eta)),
            'address' => EmailBlocks::address($order->shipping_address),
        ];
    }
}
