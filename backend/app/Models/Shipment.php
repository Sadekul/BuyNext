<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** The parcel left the warehouse: carrier and (optional) tracking number. "SHP-100001". */
#[Fillable(['order_id', 'carrier', 'tracking_number', 'admin_id', 'note', 'customer_notified'])]
class Shipment extends Model
{
    public const UPDATED_AT = null;

    /** Carrier id => [label, tracking page ({n} = the tracking number), or null when we don't know one]. */
    public const CARRIERS = [
        'dhl' => ['DHL', 'https://www.dhl.com/en/express/tracking.html?AWB={n}'],
        'fedex' => ['FedEx', 'https://www.fedex.com/fedextrack/?trknbr={n}'],
        'ups' => ['UPS', 'https://www.ups.com/track?tracknum={n}'],
        'usps' => ['USPS', 'https://tools.usps.com/go/TrackConfirmAction?tLabels={n}'],
        'other' => ['Other', null],
    ];

    protected function casts(): array
    {
        return ['customer_notified' => 'boolean'];
    }

    public static function numberFor(int $id): string
    {
        return 'SHP-'.(100000 + $id);
    }

    public function carrierLabel(): string
    {
        return self::CARRIERS[$this->carrier][0] ?? ucfirst($this->carrier);
    }

    /** The carrier's tracking page, or null (unknown carrier, or no tracking number). */
    public function trackingUrl(): ?string
    {
        $template = self::CARRIERS[$this->carrier][1] ?? null;

        return $template && filled($this->tracking_number)
            ? str_replace('{n}', rawurlencode($this->tracking_number), $template)
            : null;
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function admin(): BelongsTo
    {
        return $this->belongsTo(Admin::class);
    }
}
