<?php

namespace App\Services\Couriers;

use App\Mail\OrderStatusMail;
use App\Mail\ShipmentMail;
use App\Models\Admin;
use App\Models\AdminNotification;
use App\Models\BdArea;
use App\Models\BdDistrict;
use App\Models\Order;
use App\Models\Shipment;
use App\Services\AdminNotifications;
use App\Services\Audit;
use App\Services\BdAddresses;
use App\Services\OrderDocuments;
use App\Services\Pricing;
use App\Services\Settings;
use App\Support\Currency;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Phase 18: courier bookings, the rules that are the same for every courier.
 * The couriers' own wire formats live in their gateways (SteadfastGateway,
 * PathaoGateway).
 *
 * - book(): one order → one parcel with the courier, then the shipment
 *   through OrderDocuments::ship() (same rules and emails as a manual one).
 * - apply(): a status the courier reported (webhook, sync): the shipment's
 *   timeline, and on "delivered" the order is delivered and its cash
 *   collected (OrderDocuments::collect(), as staff would record it).
 * - The courier CSV (phase 14) and the bookings share the parcel helpers
 *   (phone, address line, weight), so both send the same.
 */
class Couriers
{
    /** Courier key => gateway class (the couriers with an API). */
    public const GATEWAYS = ['steadfast' => SteadfastGateway::class, 'pathao' => PathaoGateway::class];

    public const NOTE_MAX = 200;

    public function __construct(private OrderDocuments $documents, private Audit $audit, private Settings $settings, private AdminNotifications $notifications) {}

    public function find(string $key): ?CourierGateway
    {
        return isset(self::GATEWAYS[$key]) ? app(self::GATEWAYS[$key]) : null;
    }

    public function gateway(string $key): CourierGateway
    {
        return $this->find($key) ?? throw ValidationException::withMessages(['courier' => __('Choose a courier.')]);
    }

    /** @return list<CourierGateway> */
    public function all(): array
    {
        return array_map(fn ($key) => $this->gateway($key), array_keys(self::GATEWAYS));
    }

    /** The webhook address to paste in the courier's panel (the API's own address, not the storefront's). */
    public static function webhookUrl(string $key): string
    {
        return url("/api/v1/couriers/{$key}/webhook");
    }

    /**
     * GET /api/admin/v1/couriers: { key, label, configured, mode, balance, webhook_url } per courier.
     * Never a credential. $balance: ask the couriers that have a balance call (cached 5 minutes).
     */
    public function summary(bool $balance = false): array
    {
        return array_map(fn (CourierGateway $gateway) => [
            'key' => $gateway->key(),
            'label' => $gateway->label(),
            'configured' => $gateway->configured(),
            'mode' => $gateway->mode(),
            'balance' => $balance && $gateway->configured() ? $this->balance($gateway) : null,
            'webhook_url' => self::webhookUrl($gateway->key()),
        ], $this->all());
    }

    /** "৳12,500.00", or null (no balance call, or the courier didn't answer). */
    private function balance(CourierGateway $gateway): ?string
    {
        try {
            $cents = cache()->remember("couriers.{$gateway->key()}.balance", 300, fn () => $gateway->balanceCents());
        } catch (CourierException) {
            return null;
        }

        return $cents === null ? null : Currency::formatCents($cents, 'BDT');
    }

    /** Settings → Couriers. */
    public function settings(): array
    {
        return [
            'courier_default' => $this->settings->get('courier_default'),
            'courier_auto_sync' => (bool) $this->settings->get('courier_auto_sync', true),
            'courier_note_template' => $this->settings->get('courier_note_template'),
            'courier_pathao_item_type' => $this->settings->get('courier_pathao_item_type', 'parcel'),
            'courier_pathao_delivery_type' => $this->settings->get('courier_pathao_delivery_type', 'normal'),
        ];
    }

    /*
     * Parcel helpers, shared with the courier CSV (CourierController::row()).
     */

    /** "+8801712345678" → "01712345678" (the 11-digit form Bangladeshi couriers take); anything else unchanged. */
    public static function localPhone(?string $phone): ?string
    {
        return preg_match('/^\+880(1\d{9})$/', (string) $phone, $m) ? '0'.$m[1] : $phone;
    }

    /** The address as one line without the country (a structured Bangladesh address in English). */
    public static function addressLine(?array $address): string
    {
        $address ??= [];
        $lines = BdAddresses::lines($address, 'en');

        return $lines ? implode(', ', array_slice($lines, 0, -1)) : implode(', ', array_filter([$address['line1'] ?? null, $address['line2'] ?? null,
            $address['city'] ?? null, $address['state'] ?? null, $address['postal_code'] ?? null]));
    }

    /** The parcel's weight in grams: every item but gift cards, products without a weight count $defaultWeight. */
    public static function parcelGrams(Order $order, int $defaultWeight): int
    {
        $order->loadMissing(['items.product', 'items.variant']);

        return (int) $order->items->filter(fn ($item) => ! $item->isGiftCard())->sum(fn ($item) => $item->quantity
            * (int) ($item->variant?->weight ?? $item->product?->weight ?? $defaultWeight));
    }

    /** The order's phone as a courier takes it (01XXXXXXXXX), or null when it isn't a Bangladeshi mobile. */
    public static function courierPhone(?string $phone): ?string
    {
        $local = self::localPhone(BdAddresses::normalizePhone((string) $phone));

        return preg_match('/^01[3-9]\d{8}$/', (string) $local) ? $local : null;
    }

    /*
     * Booking.
     */

    /**
     * GET /api/admin/v1/orders/{number}/courier-booking: what the booking dialog starts with.
     * Phase 18 additions beyond the contract's fields: problem (why the order can't be
     * booked now, or null) and awaits_confirmation (an unconfirmed COD order: a reason is needed).
     */
    public function defaults(Order $order): array
    {
        $configured = array_values(array_filter($this->all(), fn (CourierGateway $gateway) => $gateway->configured()));
        $default = $this->settings->get('courier_default');
        $grams = self::parcelGrams($order, $this->defaultWeight()) ?: $this->defaultWeight();

        return [
            'courier_default' => collect($configured)->contains(fn ($gateway) => $gateway->key() === $default) ? $default : null,
            'couriers' => array_map(fn (CourierGateway $gateway) => ['key' => $gateway->key(), 'label' => $gateway->label(), 'mode' => $gateway->mode()], $configured),
            'cod_amount' => Pricing::format($order->isCod() ? $order->codDueCents() : 0),
            'weight_kg' => round($grams / 1000, 2),
            'note' => $this->settings->get('courier_note_template'),
            'phone' => self::courierPhone($order->phone),
            'address_line' => self::addressLine($order->shipping_address),
            'pathao_match' => $this->pathaoMatch($order),
            'problem' => match (true) {
                Currency::store() !== 'BDT' => __('Couriers collect taka: switch the store currency to taka first.'),
                $configured === [] => __('Set up a courier first (Settings → Couriers).'),
                default => $this->bookedProblem($order) ?? $this->documents->shipProblem($order, 'override'),
            },
            'awaits_confirmation' => $order->awaitsConfirmation(),
        ];
    }

    /**
     * Pathao city and zone for the order's address: our district → Pathao city,
     * our area (upazila / thana) → Pathao zone, by case-insensitive name. null
     * where nothing matches (never a guess); area_id is left to staff.
     */
    public function pathaoMatch(Order $order): array
    {
        $match = ['city_id' => null, 'zone_id' => null, 'area_id' => null];
        $pathao = $this->gateway('pathao');
        $address = $order->shipping_address;
        if (! $pathao instanceof PathaoGateway || ! $pathao->configured() || ! BdAddresses::hasPlaces($address)) {
            return $match;
        }
        $same = fn (?string $a, ?string $b) => $a !== null && $b !== null && mb_strtolower(trim($a)) === mb_strtolower(trim($b));
        $district = BdDistrict::find((int) $address['district_id']);
        $area = BdArea::find((int) $address['area_id']);

        try {
            $city = collect($pathao->cities())->first(fn ($city) => $same($city['name'], $district?->name));
            if ($city) {
                $match['city_id'] = $city['id'];
                $zone = collect($pathao->zones($city['id']))->first(fn ($zone) => $same($zone['name'], $area?->name ?? $address['area'] ?? null));
                $match['zone_id'] = $zone['id'] ?? null;
            }
        } catch (CourierException) {
            // Pathao unreachable: staff choose by hand.
        }

        return $match;
    }

    /**
     * Books $order with $courier and ships it. $options: cod_amount (taka, "1250.00"), weight_kg,
     * note, notify_customer, confirmation_override, pathao { city_id, zone_id, area_id, delivery_type, item_type }.
     * 422 (courier, order, phone, address, cod_amount, pathao.*) when it can't; nothing is saved
     * when the courier refuses. The shipment email goes out after the commit.
     */
    public function book(Order $order, Admin $admin, string $courier, array $options): Shipment
    {
        $gateway = $this->gateway($courier);
        if (! $gateway->configured()) {
            throw ValidationException::withMessages(['courier' => __('Set up :courier first (Settings → Couriers).', ['courier' => $gateway->label()])]);
        }
        if (Currency::store() !== 'BDT') {
            throw ValidationException::withMessages(['courier' => __('Couriers collect taka: switch the store currency to taka first.')]);
        }
        $notify = (bool) ($options['notify_customer'] ?? true);

        $shipment = DB::transaction(function () use ($order, $admin, $gateway, $options, $notify) {
            // The order row stays locked during the courier call (≤ 20 s): two clicks can't book twice.
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            if ($problem = $this->bookedProblem($order)) {
                throw ValidationException::withMessages(['order' => $problem]);
            }
            $override = $options['confirmation_override'] ?? null;
            if ($problem = $this->documents->shipProblem($order, $override)) {
                throw ValidationException::withMessages(['order' => __($problem)]);
            }
            $parcel = $this->parcel($order, $gateway, $options);

            try {
                $booking = $gateway->book($parcel);
            } catch (CourierException $e) {
                throw ValidationException::withMessages(['courier' => $e->getMessage()]);
            }

            try {
                $note = $parcel['note'];
                $shipment = $this->documents->ship($order, $admin, $gateway->key(), $booking->trackingCode, $note, $notify, confirmationOverride: $override);
                $now = now();
                $shipment->forceFill([
                    'courier_consignment_id' => $booking->consignmentId,
                    'courier_status' => mb_substr($booking->courierStatus, 0, 60),
                    'delivery_status' => 'booked',
                    'cod_amount_cents' => $parcel['cod_cents'],
                    'courier_fee_cents' => $booking->feeCents,
                    'booked_via_api' => true,
                    'status_updated_at' => $now,
                    'last_synced_at' => $now,
                ])->save();
                $shipment->events()->create(['delivery_status' => 'booked', 'courier_status' => $shipment->courier_status,
                    'message' => null, 'source' => 'booking', 'occurred_at' => $now]);
                $this->audit->record('shipment.booked', "Order {$order->number} booked with {$gateway->label()} (consignment {$booking->consignmentId}).",
                    'shipment', $shipment->id, ['before' => [], 'after' => ['courier' => $gateway->key(), 'consignment_id' => $booking->consignmentId,
                        'tracking_code' => $booking->trackingCode, 'cod_amount' => Pricing::format($parcel['cod_cents'])]], $admin);
            } catch (Throwable $e) {
                // The courier has the parcel but we couldn't save it: staff must cancel it in the courier's panel.
                Log::critical('A courier booking could not be saved.', ['order' => $order->number, 'courier' => $gateway->key(),
                    'consignment_id' => $booking->consignmentId, 'exception' => $e::class]);
                throw $e;
            }

            return $shipment;
        });

        $shipment->load(['order', 'admin', 'events']);
        if ($notify) {
            try {
                Mail::to($shipment->order->email)->send(new ShipmentMail($shipment));
            } catch (Throwable $e) {
                report($e);
            }
        }

        return $shipment;
    }

    /** "This order is already booked with Steadfast (123)." for an order with a live API booking; else null. */
    private function bookedProblem(Order $order): ?string
    {
        $booked = $order->shipments()->where('booked_via_api', true)->where('delivery_status', '!=', 'cancelled')->latest('id')->first();

        return $booked ? __('This order is already booked with :courier (:consignment).',
            ['courier' => $booked->carrierLabel(), 'consignment' => $booked->courier_consignment_id]) : null;
    }

    /** The parcel for the gateway (see CourierGateway::book()), or 422 when the order lacks something a courier needs. */
    private function parcel(Order $order, CourierGateway $gateway, array $options): array
    {
        $phone = self::courierPhone($order->phone);
        if (! $phone) {
            throw ValidationException::withMessages(['phone' => __('A courier needs the customer\'s Bangladeshi mobile number.')]);
        }
        $address = $order->shipping_address;
        $line = self::addressLine($address);
        $name = trim(($address['first_name'] ?? '').' '.($address['last_name'] ?? ''));
        if (! is_array($address) || $line === '' || $name === '') {
            throw ValidationException::withMessages(['address' => __('A courier needs the shipping address.')]);
        }

        $total = Pricing::toCents($order->grand_total);
        $cod = isset($options['cod_amount']) && $options['cod_amount'] !== '' ? Pricing::toCents((string) $options['cod_amount'])
            : ($order->isCod() ? $order->codDueCents() : 0);
        if ($cod < 0 || $cod > $total) {
            throw ValidationException::withMessages(['cod_amount' => __('The cash to collect must be between 0 and the order total (:total).',
                ['total' => $order->money($order->grand_total)])]);
        }
        $grams = isset($options['weight_kg']) && $options['weight_kg'] !== '' ? (int) round(((float) $options['weight_kg']) * 1000)
            : (self::parcelGrams($order, $this->defaultWeight()) ?: $this->defaultWeight());
        $note = array_key_exists('note', $options) ? $options['note'] : $this->settings->get('courier_note_template');
        $note = filled($note) ? mb_substr(trim((string) $note), 0, self::NOTE_MAX) : null;

        $parcel = [
            'invoice' => $order->number,
            'recipient_name' => $name,
            'recipient_phone' => $phone,
            'recipient_address' => $line,
            'cod_cents' => $cod,
            'weight_grams' => max(1, $grams),
            'item_quantity' => max(1, (int) $order->items->reject(fn ($item) => $item->isGiftCard())->sum('quantity')),
            'note' => $note,
        ];
        if ($gateway->key() === 'pathao') {
            $pathao = (array) ($options['pathao'] ?? []);
            $missing = array_filter([
                'pathao.city_id' => empty($pathao['city_id']) ? __('Choose the city.') : null,
                'pathao.zone_id' => empty($pathao['zone_id']) ? __('Choose the zone.') : null,
            ]);
            if ($missing) {
                throw ValidationException::withMessages($missing);
            }
            $parcel['pathao'] = [
                'city_id' => (int) $pathao['city_id'],
                'zone_id' => (int) $pathao['zone_id'],
                'area_id' => empty($pathao['area_id']) ? null : (int) $pathao['area_id'],
                'delivery_type' => $pathao['delivery_type'] ?? $this->settings->get('courier_pathao_delivery_type', 'normal'),
                'item_type' => $pathao['item_type'] ?? $this->settings->get('courier_pathao_item_type', 'parcel'),
            ];
        }

        return $parcel;
    }

    private function defaultWeight(): int
    {
        return max(1, (int) $this->settings->get('default_weight_grams', 500));
    }

    /*
     * Status updates.
     */

    /** Asks the courier now (Refresh status, the sync command) and applies the answer. @throws CourierException */
    public function sync(Shipment $shipment, string $source = 'sync'): bool
    {
        $gateway = $this->gateway($shipment->carrier);

        return $this->apply($shipment, $gateway->status($shipment), $source);
    }

    /**
     * A webhook's update for $consignment: 'applied', 'unchanged', or 'unknown'
     * (no such consignment of this courier: logged, and answered as received
     * so the courier doesn't retry forever).
     */
    public function receive(string $courier, string $consignment, StatusResult $result): string
    {
        $shipment = Shipment::where('carrier', $courier)->where('courier_consignment_id', $consignment)->first();
        if (! $shipment) {
            Log::info('A courier webhook named an unknown consignment.', ['courier' => $courier, 'consignment_id' => $consignment]);

            return 'unknown';
        }

        return $this->apply($shipment, $result, 'webhook') ? 'applied' : 'unchanged';
    }

    /**
     * Applies a reported status (idempotent: the same status twice adds
     * nothing, only last_synced_at moves). A changed status is a timeline
     * event, and:
     * - delivered: a shipped order becomes delivered (history "Delivered —
     *   reported by {Courier}", OrderStatusMail); a COD order's cash still due
     *   is collected with the courier's amount (else the booked COD amount).
     * - partly delivered, returned, cancelled, on hold: staff are notified;
     *   the order is left for them to handle.
     * Orders never move backwards, cancelled and closed orders are never
     * touched, and cash is never collected twice. Returns: was anything new?
     */
    public function apply(Shipment $shipment, StatusResult $result, string $source): bool
    {
        $emailOrder = null;
        $changed = DB::transaction(function () use ($shipment, $result, $source, &$emailOrder) {
            $order = Order::whereKey($shipment->order_id)->lockForUpdate()->first();
            $fresh = Shipment::whereKey($shipment->id)->lockForUpdate()->firstOrFail();
            $now = now();

            $status = $result->courierStatus === null ? $fresh->delivery_status : $result->deliveryStatus;
            $raw = $result->courierStatus ?? $fresh->courier_status;
            // A late or repeated message never takes a finished parcel back to an open status.
            if (in_array($fresh->delivery_status, Shipment::FINAL_DELIVERY_STATUSES, true) && ! in_array($status, Shipment::FINAL_DELIVERY_STATUSES, true)) {
                [$status, $raw] = [$fresh->delivery_status, $fresh->courier_status];
            }
            $statusChanged = $status !== $fresh->delivery_status || $raw !== $fresh->courier_status;
            $message = filled($result->message) ? mb_substr(trim($result->message), 0, 500) : null;
            $newMessage = $message !== null && $message !== $fresh->events()->reorder()->latest('id')->value('message');

            if (! $statusChanged && ! $newMessage) {
                $fresh->forceFill(['last_synced_at' => $now])->save();

                return false;
            }
            $from = $fresh->delivery_status;
            $fresh->forceFill([
                'delivery_status' => $status,
                'courier_status' => $raw,
                'courier_fee_cents' => $result->feeCents ?? $fresh->courier_fee_cents,
                'collected_cents' => $result->collectedCents ?? $fresh->collected_cents,
                'status_updated_at' => $statusChanged ? $now : $fresh->status_updated_at,
                'last_synced_at' => $now,
            ])->save();
            $fresh->events()->create(['delivery_status' => $status, 'courier_status' => $raw, 'message' => $message, 'source' => $source, 'occurred_at' => $now]);

            if ($order && $status !== $from && $this->consequences($order, $fresh, $status, $message)) {
                $emailOrder = $order;
            }

            return true;
        });

        if ($emailOrder) {
            try {
                Mail::to($emailOrder->email)->send(new OrderStatusMail($emailOrder));
            } catch (Throwable $e) {
                report($e); // the delivery is saved either way
            }
        }
        $shipment->refresh();

        return $changed;
    }

    /** What a new delivery status changes (see apply()). Returns: email the customer that the order was delivered? */
    private function consequences(Order $order, Shipment $shipment, string $status, ?string $message): bool
    {
        if (in_array($order->status, ['cancelled', 'closed'], true)) {
            return false;
        }
        $courier = $shipment->carrierLabel();
        $link = "/orders/{$order->number}";

        switch ($status) {
            case 'delivered':
                $emailed = false;
                if ($order->status === 'shipped') {
                    $order->forceFill(['status' => 'delivered'])->save();
                    $order->history()->create([
                        'status' => 'delivered',
                        'payment_status' => $order->payment_status,
                        'note' => "Delivered — reported by {$courier}.",
                        'admin_id' => null,
                        'actor' => $courier,
                        'customer_notified' => true,
                    ]);
                    $this->audit->record('order.status_changed', "Order {$order->number}: shipped → delivered (reported by {$courier}).", 'order', $order->id,
                        ['before' => ['status' => 'shipped'], 'after' => ['status' => 'delivered', 'actor' => 'system']], anonymous: true);
                    $emailed = true;
                }
                $due = $order->codDueCents();
                if ($order->isCod() && $due > 0) {
                    $cents = min($due, $shipment->collected_cents ?? $shipment->cod_amount_cents ?? $due);
                    if ($cents > 0) {
                        try {
                            $this->documents->collect($order, null, $cents, $cents < $due ? "{$courier} reported this amount collected." : null, actor: $courier);
                        } catch (ValidationException $e) {
                            Log::warning('A courier-reported cash collection could not be recorded.', ['order' => $order->number, 'reason' => $e->getMessage()]);
                        }
                    }
                }

                return $emailed;
            case 'partly_delivered':
                $this->notifications->notify('courier_update', "shipment:{$shipment->id}:partly_delivered",
                    "Order {$order->number}: {$courier} delivered part of the parcel — check and record the cash", (string) $message, $link);

                return false;
            case 'returned':
            case 'cancelled':
                $this->notifications->notify('courier_update', "shipment:{$shipment->id}:{$status}",
                    "Order {$order->number}: {$courier} reports the parcel {$status}", (string) $message, $link);

                return false;
            case 'on_hold':
                // Once per shipment per day (read or not).
                $key = "shipment:{$shipment->id}:on_hold:".now()->toDateString();
                if (! AdminNotification::where('type', 'courier_update')->where('subject_key', $key)->exists()) {
                    $this->notifications->notify('courier_update', $key, "Order {$order->number}: {$courier} put the parcel on hold", (string) $message, $link);
                }

                return false;
            default:
                return false;
        }
    }
}
