<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * The parcel left the warehouse: carrier and (optional) tracking number. "SHP-100001".
 *
 * Phase 18: a shipment booked through a courier's API (Steadfast, Pathao)
 * also keeps the courier's consignment id, its raw status, our normalised
 * delivery_status, the cash it was asked to collect (cod_amount_cents), its
 * fee and what it reports collected, and a timeline (events).
 */
#[Fillable(['order_id', 'carrier', 'tracking_number', 'admin_id', 'note', 'customer_notified'])]
class Shipment extends Model
{
    public const UPDATED_AT = null;

    /**
     * Carrier id => [label, tracking page ({n} = the tracking number), or null when we don't know one].
     * Phase 18: the Bangladeshi couriers. Their tracking page patterns are to verify against the
     * couriers' live sites before launch (docs/BANGLADESH.md). Steadfast's page takes the tracking
     * code, Pathao's the consignment id: that is what their shipments keep as tracking_number.
     */
    public const CARRIERS = [
        'dhl' => ['DHL', 'https://www.dhl.com/en/express/tracking.html?AWB={n}'],
        'fedex' => ['FedEx', 'https://www.fedex.com/fedextrack/?trknbr={n}'],
        'ups' => ['UPS', 'https://www.ups.com/track?tracknum={n}'],
        'usps' => ['USPS', 'https://tools.usps.com/go/TrackConfirmAction?tLabels={n}'],
        'other' => ['Other', null],
        'steadfast' => ['Steadfast', 'https://steadfast.com.bd/t/{n}'], // to verify
        'pathao' => ['Pathao', 'https://merchant.pathao.com/tracking?consignment_id={n}'], // to verify
        'redx' => ['RedX', 'https://redx.com.bd/track-parcel/?trackingId={n}'], // to verify
        'paperfly' => ['Paperfly', null],
        'sundarban' => ['Sundarban Courier', null],
    ];

    /** Phase 21: the Bangladeshi couriers (they collect cash on delivery and pay it to the shop). */
    public const COURIERS = ['steadfast', 'pathao', 'redx', 'paperfly', 'sundarban'];

    /**
     * Phase 18: our normalised delivery status (each courier's own statuses map onto these).
     * "shipped" = a manual shipment without courier updates (every shipment before phase 18).
     */
    public const DELIVERY_STATUSES = ['booked', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'partly_delivered', 'on_hold',
        'returned', 'cancelled', 'shipped'];

    /** Phase 18: the courier is done with the parcel: the sync command stops asking. */
    public const FINAL_DELIVERY_STATUSES = ['delivered', 'returned', 'cancelled'];

    /** Phase 18: what people read (translated with __(); lang/bn.json). */
    public const DELIVERY_LABELS = [
        'booked' => 'Booked',
        'picked_up' => 'Picked up',
        'in_transit' => 'On the way',
        'out_for_delivery' => 'Out for delivery',
        'delivered' => 'Delivered',
        'partly_delivered' => 'Partly delivered',
        'on_hold' => 'On hold',
        'returned' => 'Returned',
        'cancelled' => 'Cancelled',
        'shipped' => 'Shipped',
    ];

    protected function casts(): array
    {
        return [
            'customer_notified' => 'boolean',
            // Phase 18.
            'booked_via_api' => 'boolean',
            'cod_amount_cents' => 'integer',
            'courier_fee_cents' => 'integer',
            'collected_cents' => 'integer',
            'status_updated_at' => 'datetime',
            'last_synced_at' => 'datetime',
        ];
    }

    /** Phase 18: "On the way" in the request's language. */
    public static function deliveryLabel(?string $status): string
    {
        return __(self::DELIVERY_LABELS[$status ?? 'shipped'] ?? 'Shipped');
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

    /** Phase 18: what the courier reported, oldest first. */
    public function events(): HasMany
    {
        return $this->hasMany(ShipmentEvent::class)->orderBy('occurred_at')->orderBy('id');
    }
}
