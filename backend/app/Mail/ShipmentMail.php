<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\Order;
use App\Models\Shipment;
use App\Services\Pricing;
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
            // Phase 14: the delivery zone and time, and the cash to keep ready for a cash on delivery order.
            'note' => EmailBlocks::note($this->shipment->note, self::storeName()).$this->delivery($order),
        ];
    }

    private function delivery(Order $order): string
    {
        $lines = array_filter([
            $order->deliveryText(),
            $order->isCod() && $order->codDueCents() > 0 ? __('Please keep :amount ready to pay the courier in cash.', ['amount' => $this->money(Pricing::format($order->codDueCents()))]) : null,
            $order->hasAdvance() && (float) $order->advance_paid > 0 ? __('Advance paid online: :amount.', ['amount' => $this->money($order->advance_paid)]) : null,
        ]);

        return $lines && ($order->delivery_zone_code !== null || $order->usesBangladeshCod()) ? EmailBlocks::paragraph(implode(' ', $lines)) : '';
    }
}
