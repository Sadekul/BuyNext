<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\Order;
use App\Support\EmailBlocks;
use App\Support\Locale;
use Illuminate\Mail\Mailable;

/** Phase 9 (part A): the customer cancelled their own order (template order_cancelled_by_customer). */
class OrderCancelledByCustomerMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public Order $order, public ?string $reason = null)
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
        return 'order_cancelled_by_customer';
    }

    protected function templateValues(): array
    {
        return [
            'customer_first_name' => $this->order->shipping_address['first_name'] ?? __('there'),
            'order_number' => $this->order->number,
            'order_total' => $this->order->grand_total,
            'reason' => filled($this->reason) ? EmailBlocks::paragraph(__('Your reason: :reason', ['reason' => $this->reason])) : '',
        ];
    }
}
