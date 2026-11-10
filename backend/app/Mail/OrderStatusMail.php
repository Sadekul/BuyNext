<?php

namespace App\Mail;

use App\Models\Order;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/** "Your order has shipped / been delivered / been cancelled", sent when staff change the status. */
class OrderStatusMail extends Mailable
{
    public const STATUSES = ['shipped', 'delivered', 'cancelled'];

    private const TEXT = [
        'shipped' => ['Your order is on its way', 'Good news: your order has left our warehouse.'],
        'delivered' => ['Your order was delivered', 'Your order has been delivered. We hope you enjoy it!'],
        'cancelled' => ['Your order was cancelled', 'Your order has been cancelled. If you already paid, the money will be refunded to you.'],
    ];

    public function __construct(public Order $order, public ?string $note = null) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: self::TEXT[$this->order->status][0]." ({$this->order->number})");
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.order-status',
            text: 'emails.order-status-text',
            with: [
                'heading' => self::TEXT[$this->order->status][0],
                'intro' => self::TEXT[$this->order->status][1],
                'name' => $this->order->shipping_address['first_name'] ?? 'there',
            ],
        );
    }
}
