<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\Shipment;
use App\Support\EmailBlocks;
use Illuminate\Mail\Mailable;

/** "Your order is on its way": carrier, tracking number, and the carrier's tracking link when we know it (template shipment). */
class ShipmentMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public Shipment $shipment) {}

    protected function templateKey(): string
    {
        return 'shipment';
    }

    protected function templateValues(): array
    {
        $order = $this->shipment->order;
        $trackingUrl = $this->shipment->trackingUrl();

        return [
            'customer_first_name' => $order->shipping_address['first_name'] ?? 'there',
            'order_number' => $order->number,
            'carrier' => $this->shipment->carrierLabel(),
            'tracking_number' => (string) $this->shipment->tracking_number,
            'tracking_url' => (string) $trackingUrl,
            'tracking' => EmailBlocks::tracking($this->shipment->carrierLabel(), $this->shipment->tracking_number),
            'button' => EmailBlocks::button($trackingUrl, 'Track your parcel'),
            'note' => EmailBlocks::note($this->shipment->note, self::storeName()),
        ];
    }
}
