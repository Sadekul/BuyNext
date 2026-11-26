<?php

namespace App\Services\Couriers;

/**
 * Phase 18: a parcel's status as a courier reports it (a status call or a
 * webhook). courierStatus null = the update carries no status (a tracking
 * message only): the shipment keeps its status and only the message is added.
 */
final readonly class StatusResult
{
    public function __construct(
        public ?string $courierStatus,
        /** One of Shipment::DELIVERY_STATUSES (ignored when courierStatus is null). */
        public string $deliveryStatus,
        public ?int $collectedCents = null,
        public ?int $feeCents = null,
        public ?string $message = null,
    ) {}
}
