<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\Invoice;
use App\Support\EmailBlocks;
use Illuminate\Mail\Mailable;

/** "Payment received": sent when staff invoice an order and chose to notify the customer (template invoice). */
class InvoiceMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public Invoice $invoice) {}

    protected function templateKey(): string
    {
        return 'invoice';
    }

    protected function templateValues(): array
    {
        $order = $this->invoice->order;

        return [
            'customer_first_name' => $order->shipping_address['first_name'] ?? 'there',
            'order_number' => $order->number,
            'invoice_number' => $this->invoice->number,
            'invoice_amount' => $this->invoice->amount,
            'note' => EmailBlocks::note($this->invoice->note, self::storeName()),
        ];
    }
}
