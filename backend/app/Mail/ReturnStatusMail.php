<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\OrderReturn;
use App\Support\EmailBlocks;
use Illuminate\Mail\Mailable;

/** "Your return RMA-… was approved / received / …": sent when a return is created and on every status change (template return_status). */
class ReturnStatusMail extends Mailable
{
    use RendersEmailTemplate;

    private const TEXT = [
        'requested' => ['We received your return request', 'We received your return request and will review it shortly. We\'ll email you as soon as it\'s approved.'],
        'approved' => ['Your return was approved', 'Your return was approved. Please pack the items securely and send them back to us, with the return number on the parcel.'],
        'rejected' => ['Your return request was declined', 'Unfortunately we can\'t accept this return.'],
        'received' => ['We received your returned items', 'Your returned items have arrived at our warehouse. We\'ll let you know once your return is settled.'],
        'refunded' => ['Your return was refunded', 'Your return has been refunded. The money goes back by the original payment method.'],
        'closed' => ['Your return is complete', 'Your return has been completed.'],
    ];

    public function __construct(public OrderReturn $return) {}

    protected function templateKey(): string
    {
        return 'return_status';
    }

    protected function templateValues(): array
    {
        $order = $this->return->order;

        return [
            'customer_first_name' => $order->shipping_address['first_name'] ?? 'there',
            'return_number' => $this->return->number,
            'order_number' => $order->number,
            'reason' => $this->return->reason,
            'status' => $this->return->status,
            'status_heading' => self::TEXT[$this->return->status][0],
            'status_message' => self::TEXT[$this->return->status][1],
            'items_table' => EmailBlocks::list($this->return->items
                ->map(fn ($item) => ($item->orderItem?->displayName() ?? 'Item')." × {$item->quantity}")->all()),
            'resolution' => $this->return->resolution === 'replace' ? EmailBlocks::paragraph('We\'ll send you a replacement.') : '',
            // Staff notes reach the customer only in an email (this one is being sent).
            'note' => EmailBlocks::note($this->return->admin_note, self::storeName()),
        ];
    }
}
