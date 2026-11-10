<?php

namespace App\Mail;

use App\Models\Order;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/** "Thanks for your order": items, totals, address, and what happens next. */
class OrderPlacedMail extends Mailable
{
    public function __construct(public Order $order) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: "Your BuyNest order {$this->order->number}");
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.order-placed',
            text: 'emails.order-placed-text',
            with: [
                'name' => $this->order->shipping_address['first_name'] ?? 'there',
                'paymentLabel' => config("buynest.store.payment_methods.{$this->order->payment_method}", $this->order->payment_method),
                'nextSteps' => $this->order->payment_method === 'cod'
                    ? 'We are preparing your order now. Please pay the courier in cash when it arrives.'
                    : 'Your items are reserved. Online payment is not connected yet: we will contact you with a secure payment link, and we start preparing your order as soon as it is paid.',
            ],
        );
    }
}
