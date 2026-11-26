<?php

namespace App\Services\Couriers;

/** Phase 18: what a courier answered to a booking. */
final readonly class BookingResult
{
    public function __construct(
        public string $consignmentId,
        /** What the customer tracks the parcel with (Steadfast: its tracking code; Pathao: the consignment id). */
        public string $trackingCode,
        public string $courierStatus,
        public ?int $feeCents = null,
    ) {}
}
