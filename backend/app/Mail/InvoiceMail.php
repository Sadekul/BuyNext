<?php

namespace App\Mail;

use App\Models\Invoice;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/** "Payment received": sent when staff invoice an order (and chose to notify the customer). */
class InvoiceMail extends Mailable
{
    public function __construct(public Invoice $invoice) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: "Payment received for order {$this->invoice->order->number}");
    }

    public function content(): Content
    {
        $order = $this->invoice->order;

        return new Content(
            view: 'emails.invoice',
            text: 'emails.invoice-text',
            with: [
                'order' => $order,
                'name' => $order->shipping_address['first_name'] ?? 'there',
                'note' => $this->invoice->note,
            ],
        );
    }
}
