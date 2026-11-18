<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\Invoice;
use App\Models\Order;
use App\Services\DocumentPdfs;
use App\Services\Settings;
use App\Support\EmailBlocks;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Throwable;

/**
 * "Payment received": sent when staff invoice an order and chose to notify the customer (template invoice).
 * Phase 10 (part A): with the invoice as a PDF attached (setting documents.attach_pdf_to_emails, on by default).
 */
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
            // Phase 11: "You earned 120 reward points with this order." (empty when none). Read fresh: points are earned after the invoice is made.
            'reward_points_earned' => ($earned = (int) Order::whereKey($order->id)->value('reward_points_earned')) > 0
                ? EmailBlocks::paragraph('You earned '.number_format($earned).' reward '.($earned === 1 ? 'point' : 'points').' with this order.')
                : '',
        ];
    }

    /** Phase 10 (part A): INV-100001.pdf, made when the email is sent. If it can't be made, the email goes without it. */
    public function attachments(): array
    {
        if (! app(Settings::class)->get('attach_pdf_to_emails', true)) {
            return [];
        }
        try {
            $pdf = app(DocumentPdfs::class)->pdf($this->invoice);
        } catch (Throwable $e) {
            report($e);

            return [];
        }

        return [Attachment::fromData(fn () => $pdf, DocumentPdfs::filename($this->invoice))->withMime('application/pdf')];
    }
}
