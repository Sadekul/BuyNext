<?php

namespace App\Mail;

use App\Models\Shipment;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/** "Your order is on its way": carrier, tracking number, and the carrier's tracking link when we know it. */
class ShipmentMail extends Mailable
{
    public function __construct(public Shipment $shipment) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: "Your order is on its way ({$this->shipment->order->number})");
    }

    public function content(): Content
    {
        $order = $this->shipment->order;

        return new Content(
            view: 'emails.shipment',
            text: 'emails.shipment-text',
            with: [
                'order' => $order,
                'name' => $order->shipping_address['first_name'] ?? 'there',
                'carrier' => $this->shipment->carrierLabel(),
                'trackingNumber' => $this->shipment->tracking_number,
                'trackingUrl' => $this->shipment->trackingUrl(),
                'note' => $this->shipment->note,
            ],
        );
    }
}
