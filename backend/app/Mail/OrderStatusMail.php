<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\Order;
use App\Support\EmailBlocks;
use App\Support\Locale;
use Illuminate\Mail\Mailable;

/** "Your order has shipped / been delivered / been cancelled", sent when staff change the status (template order_status). */
class OrderStatusMail extends Mailable
{
    use RendersEmailTemplate;

    public const STATUSES = ['shipped', 'delivered', 'cancelled'];

    private const TEXT = [
        'shipped' => ['Your order is on its way', 'Good news: your order has left our warehouse.'],
        'delivered' => ['Your order was delivered', 'Your order has been delivered. We hope you enjoy it!'],
        'cancelled' => ['Your order was cancelled', 'Your order has been cancelled. If you already paid, the money will be refunded to you.'],
    ];

    public function __construct(public Order $order, public ?string $note = null)
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
        return 'order_status';
    }

    protected function templateValues(): array
    {
        return [
            'customer_first_name' => $this->order->shipping_address['first_name'] ?? __('there'),
            'order_number' => $this->order->number,
            'order_total' => $this->order->grand_total,
            'status' => $this->order->status,
            'status_heading' => __(self::TEXT[$this->order->status][0] ?? 'Your order was updated'),
            'status_message' => isset(self::TEXT[$this->order->status]) ? __(self::TEXT[$this->order->status][1]) : '',
            'note' => EmailBlocks::note($this->note, self::storeName()),
        ];
    }
}
