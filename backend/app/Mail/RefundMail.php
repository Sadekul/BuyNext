<?php

namespace App\Mail;

use App\Models\CreditMemo;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/** "Refund for order BN-…": what was refunded (items, shipping, adjustment). */
class RefundMail extends Mailable
{
    public function __construct(public CreditMemo $memo) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: "Refund for order {$this->memo->order->number}");
    }

    public function content(): Content
    {
        $order = $this->memo->order;

        return new Content(
            view: 'emails.refund',
            text: 'emails.refund-text',
            with: [
                'order' => $order,
                'memo' => $this->memo,
                'name' => $order->shipping_address['first_name'] ?? 'there',
                'paymentLabel' => config("buynest.store.payment_methods.{$order->payment_method}", $order->payment_method),
                'note' => $this->memo->note,
            ],
        );
    }
}
