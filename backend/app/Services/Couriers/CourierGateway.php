<?php

namespace App\Services\Couriers;

use App\Models\Shipment;
use Illuminate\Http\Request;

/**
 * Phase 18: one courier's merchant API (Steadfast, Pathao; RedX, Paperfly
 * and Sundarban can follow with the same interface). Each courier's wire
 * format lives in its one gateway class, so a correction is a one-file
 * change; Couriers holds the rules that are the same for every courier.
 */
interface CourierGateway
{
    /** "steadfast", also the shipment's carrier. */
    public function key(): string;

    public function label(): string;

    /** Are its credentials in backend/.env? */
    public function configured(): bool;

    /** "sandbox" | "live", or null when the courier has no such switch. */
    public function mode(): ?string;

    /**
     * Books a parcel. $parcel (built by Couriers::parcel()): invoice,
     * recipient_name, recipient_phone (01XXXXXXXXX), recipient_address,
     * cod_cents, weight_grams, item_quantity, note, and the courier's own
     * options (pathao: city_id, zone_id, area_id, delivery_type, item_type).
     *
     * @throws CourierException with the courier's reason
     */
    public function book(array $parcel): BookingResult;

    /** @throws CourierException */
    public function status(Shipment $shipment): StatusResult;

    /** The merchant balance in cents, or null when the courier has no such call. */
    public function balanceCents(): ?int;

    /** The courier's raw status → one of Shipment::DELIVERY_STATUSES. */
    public function normalise(string $raw): string;

    /** Is the webhook's shared secret set? (Without it the webhook answers 404.) */
    public function webhookConfigured(): bool;

    /** Does the request carry the right secret (hash_equals)? */
    public function authorizeWebhook(Request $request): bool;

    /**
     * A webhook body → [consignment id, StatusResult], or null when it isn't
     * a status update (an integration check, an unknown event).
     *
     * @return array{0: string, 1: StatusResult}|null
     */
    public function parseWebhook(array $payload): ?array;
}
