<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\Shipment;
use App\Support\EmailBlocks;
use App\Support\Locale;
use Illuminate\Mail\Mailable;

/** "Your order is on its way": carrier, tracking number, and the carrier's tracking link when we know it (template shipment). */
class ShipmentMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public Shipment $shipment)
    {
        $this->locale(Locale::forOrder($shipment->order)); // phase 13
    }

    /** Phase 12: the order's currency. */
    protected function templateCurrency(): ?string
    {
        return $this->shipment->order?->currencyCode();
    }

    protected function templateKey(): string
    {
        return 'shipment';
    }

    protected function templateValues(): array
    {
        $order = $this->shipment->order;
        $trackingUrl = $this->shipment->trackingUrl();

        return [
            'customer_first_name' => $order->shipping_address['first_name'] ?? __('there'),
            'order_number' => $order->number,
            'carrier' => __($this->shipment->carrierLabel()),
            'tracking_number' => (string) $this->shipment->tracking_number,
            'tracking_url' => (string) $trackingUrl,
            'tracking' => EmailBlocks::tracking(__($this->shipment->carrierLabel()), $this->shipment->tracking_number),
            'button' => EmailBlocks::button($trackingUrl, __('Track your parcel')),
            'note' => EmailBlocks::note($this->shipment->note, self::storeName()),
        ];
    }
}
