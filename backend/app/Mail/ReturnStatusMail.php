<?php

namespace App\Mail;

use App\Models\OrderReturn;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/** "Your return RMA-… was approved / received / …": sent when a return is created and on every status change. */
class ReturnStatusMail extends Mailable
{
    private const TEXT = [
        'requested' => ['We received your return request', 'We received your return request and will review it shortly. We\'ll email you as soon as it\'s approved.'],
        'approved' => ['Your return was approved', 'Your return was approved. Please pack the items securely and send them back to us, with the return number on the parcel.'],
        'rejected' => ['Your return request was declined', 'Unfortunately we can\'t accept this return.'],
        'received' => ['We received your returned items', 'Your returned items have arrived at our warehouse. We\'ll let you know once your return is settled.'],
        'refunded' => ['Your return was refunded', 'Your return has been refunded. The money goes back by the original payment method.'],
        'closed' => ['Your return is complete', 'Your return has been completed.'],
    ];

    public function __construct(public OrderReturn $return) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: self::TEXT[$this->return->status][0]." ({$this->return->number})");
    }

    public function content(): Content
    {
        $order = $this->return->order;

        return new Content(
            view: 'emails.return-status',
            text: 'emails.return-status-text',
            with: [
                'heading' => self::TEXT[$this->return->status][0],
                'intro' => self::TEXT[$this->return->status][1],
                'name' => $order->shipping_address['first_name'] ?? 'there',
                'order' => $order,
                'items' => $this->return->items->map(fn ($item) => [
                    'name' => $item->orderItem?->displayName() ?? 'Item',
                    'quantity' => $item->quantity,
                ])->all(),
                // Staff notes reach the customer only in an email (this one is being sent).
                'note' => $this->return->admin_note,
                'resolution' => $this->return->resolution === 'replace' ? 'We\'ll send you a replacement.' : null,
            ],
        );
    }
}
