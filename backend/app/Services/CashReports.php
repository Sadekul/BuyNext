<?php

namespace App\Services;

use App\Models\CourierPayout;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Shipment;
use App\Services\Payments\SslCommerzPayments;
use App\Support\Currency;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Pagination\LengthAwarePaginator;

/**
 * Phase 21: the money reports (docs/backend/PHASE21_CONTRACT.md). In a cash
 * on delivery store most money isn't in the shop's account on the day of the
 * sale: it is with a courier, a delivery person, or still owed. These answer
 * "what money came in" (payments) and "where is the cash" (cod), from the
 * invoices (kind / collected_via), the shipments and the courier payments.
 *
 * Read-only figures from real records: a fee nobody reported is null ("Not
 * reported"), never 0. Money is added up in the store currency only. Days are
 * the store time zone's (Reports::bounds() / localDate()).
 *
 * Gift cards and reward points: a paid order's invoice is for its whole grand
 * total, and the part a gift card or reward points paid is not money that
 * arrived through the provider (or a courier). That part is counted on its
 * own channel (gift_card, reward_points), carved off the order's first
 * invoices (never off an advance).
 */
class CashReports
{
    /** Online providers whose payments are channels of their own. */
    private const PROVIDERS = ['stripe', 'paypal', 'sslcommerz'];

    /** Parcels a courier charges a fee for (a booking cancelled before pickup costs nothing). */
    private const FEE_STATUSES = ['delivered', 'partly_delivered', 'returned'];

    private const SSLCOMMERZ_LABELS = ['bkash' => 'bKash', 'nagad' => 'Nagad', 'rocket' => 'Rocket', 'upay' => 'Upay', 'card' => 'Card',
        'internet_banking' => 'Internet banking', 'other' => 'Other'];

    public function __construct(private Reports $reports) {}

    /**
     * GET reports/payments: money received by the day it arrived (invoices.created_at), and refunds paid out
     * (credit memos by created_at). { currency, other_currencies, totals, channels, series } (see the contract).
     */
    public function payments(CarbonImmutable $from, CarbonImmutable $to, string $groupBy): array
    {
        $store = Currency::store();
        $bounds = $this->reports->bounds($from, $to);
        $invoices = Invoice::with('order:id,currency,payment_method,payment_provider,payment_reference,payment_details,gift_card_amount,reward_points_amount')
            ->whereBetween('created_at', $bounds)->orderBy('id')->get(['id', 'order_id', 'amount', 'kind', 'collected_via', 'admin_id', 'created_at']);
        $parts = $this->parts($invoices);

        $series = [];
        foreach ($this->reports->periods($from, $to, $groupBy) as $period) {
            $series[$period] = ['period' => $period, 'online' => 0, 'cod_cash' => 0, 'other' => 0, 'refunds' => 0];
        }
        $totals = ['online' => 0, 'cod_cash' => 0, 'other' => 0, 'refunds' => 0];
        $channels = [];
        $others = [];
        foreach ($invoices as $invoice) {
            $currency = $invoice->order?->currencyCode() ?? $store;
            if ($currency !== $store) {
                $others[$currency] ??= ['received' => 0, 'count' => 0, 'refunds' => 0];
                $others[$currency]['received'] += Pricing::toCents($invoice->amount);
                $others[$currency]['count']++;

                continue;
            }
            $period = $this->reports->periodOf($this->reports->localDate($invoice->created_at), $groupBy);
            foreach ($parts[$invoice->id] as $channel => $cents) {
                if ($cents <= 0) {
                    continue;
                }
                $group = self::groupOf($channel);
                $series[$period][$group] += $cents;
                $totals[$group] += $cents;
                $channels[$channel] ??= ['channel' => $channel, 'label' => self::channelLabel($channel), 'amount' => 0, 'count' => 0];
                $channels[$channel]['amount'] += $cents;
                $channels[$channel]['count']++;
            }
        }

        $memos = Order::query()->join('credit_memos', 'credit_memos.order_id', '=', 'orders.id')
            ->whereBetween('credit_memos.created_at', $bounds)
            ->toBase()->get(['orders.currency', 'credit_memos.created_at', 'credit_memos.total']);
        foreach ($memos as $memo) {
            $cents = Pricing::toCents((string) $memo->total);
            $currency = strtoupper((string) ($memo->currency ?: 'USD'));
            if ($currency !== $store) {
                $others[$currency] ??= ['received' => 0, 'count' => 0, 'refunds' => 0];
                $others[$currency]['refunds'] += $cents;

                continue;
            }
            $series[$this->reports->periodOf($this->reports->localDate($memo->created_at), $groupBy)]['refunds'] += $cents;
            $totals['refunds'] += $cents;
        }

        usort($channels, fn (array $a, array $b) => [$b['amount'], $a['channel']] <=> [$a['amount'], $b['channel']]);
        ksort($others);
        $received = $totals['online'] + $totals['cod_cash'] + $totals['other'];

        return [
            'currency' => $store,
            'other_currencies' => array_map(fn (string $code, array $row) => [
                'currency' => $code,
                'received' => Pricing::format($row['received']),
                'count' => $row['count'],
                'refunds' => Pricing::format($row['refunds']),
                'net_received' => Pricing::format($row['received'] - $row['refunds']),
            ], array_keys($others), $others),
            'totals' => [
                'received' => Pricing::format($received),
                'online' => Pricing::format($totals['online']),
                'cod_cash' => Pricing::format($totals['cod_cash']),
                'other' => Pricing::format($totals['other']),
                'refunds' => Pricing::format($totals['refunds']),
                'net_received' => Pricing::format($received - $totals['refunds']),
            ],
            'channels' => array_map(fn (array $row) => [...$row, 'amount' => Pricing::format($row['amount'])], $channels),
            'series' => array_values(array_map(fn (array $row) => [
                'period' => $row['period'],
                'online' => Pricing::format($row['online']),
                'cod_cash' => Pricing::format($row['cod_cash']),
                'other' => Pricing::format($row['other']),
                'refunds' => Pricing::format($row['refunds']),
                'net_received' => Pricing::format($row['online'] + $row['cod_cash'] + $row['other'] - $row['refunds']),
            ], $series)),
        ];
    }

    /**
     * GET reports/cod: { currency, period: [per courier, the range], balances: [per courier, all time],
     * outstanding: { orders, amount }, staff: { collected } } (see the contract). Store currency only.
     */
    public function cod(CarbonImmutable $from, CarbonImmutable $to): array
    {
        $store = Currency::store();
        $bounds = $this->reports->bounds($from, $to);

        // Counts: COD parcels by courier. Shipped = booked / handed over in the range; delivered, returned,
        // cancelled = parcels whose latest status is that, reached in the range.
        $shipped = $this->codShipments()->whereBetween('shipments.created_at', $bounds)
            ->selectRaw('shipments.carrier as carrier, count(*) as n')->groupBy('shipments.carrier')->toBase()->pluck('n', 'carrier');
        $finished = $this->codShipments()->whereIn('shipments.delivery_status', Shipment::FINAL_DELIVERY_STATUSES)
            ->whereRaw('coalesce(shipments.status_updated_at, shipments.created_at) between ? and ?', $bounds)
            ->selectRaw('shipments.carrier as carrier, shipments.delivery_status as status, count(*) as n')
            ->groupBy('shipments.carrier', 'shipments.delivery_status')->toBase()->get();

        $collected = $this->collections($bounds);
        $fees = $this->parcelFees($bounds);
        $payouts = $this->payouts($from->toDateString(), $to->toDateString());
        $period = [];
        foreach (Shipment::COURIERS as $carrier) {
            $count = fn (string $status) => (int) ($finished->first(fn ($row) => $row->carrier === $carrier && $row->status === $status)?->n ?? 0);
            $row = [
                'shipped' => (int) ($shipped[$carrier] ?? 0),
                'delivered' => $count('delivered'),
                'returned' => $count('returned'),
                'cancelled' => $count('cancelled'),
                'collected' => $collected[$carrier] ?? 0,
                ...$this->feesOf($fees[$carrier] ?? null, $payouts[$carrier] ?? null),
                'payouts' => $payouts[$carrier]['amount'] ?? 0,
            ];
            if ($row['shipped'] + $row['delivered'] + $row['returned'] + $row['cancelled'] === 0 && $row['collected'] === 0
                && ! $row['fees_reported'] && ! isset($payouts[$carrier])) {
                continue;
            }
            $period[] = ['carrier' => $carrier, 'label' => self::carrierLabel($carrier), ...$row,
                'collected' => Pricing::format($row['collected']), 'fees' => $row['fees'] === null ? null : Pricing::format($row['fees']),
                'payouts' => Pricing::format($row['payouts'])];
        }

        return [
            'currency' => $store,
            'period' => $period,
            'balances' => $this->balances(),
            'outstanding' => $this->outstandingTotals(),
            'staff' => ['collected' => Pricing::format($collected['staff'] ?? 0)],
        ];
    }

    /**
     * All time, per courier with anything recorded: [{ carrier, label, collected_all_time, fees_all_time|null,
     * fees_reported, payouts_all_time, owed, note|null, last_payout_on|null }]. owed = collected − fees − payouts;
     * below 0 it is shown as it is, with note "paid_more_than_recorded" (payments recorded) or
     * "fees_more_than_collected" (none: the shop owes the courier its fees).
     */
    public function balances(): array
    {
        $collected = $this->collections(null);
        $fees = $this->parcelFees(null);
        $payouts = $this->payouts(null, null);
        $rows = [];
        foreach (Shipment::COURIERS as $carrier) {
            $in = $collected[$carrier] ?? 0;
            $fee = $this->feesOf($fees[$carrier] ?? null, $payouts[$carrier] ?? null);
            $paid = $payouts[$carrier]['amount'] ?? 0;
            if ($in === 0 && ! $fee['fees_reported'] && ! isset($payouts[$carrier])) {
                continue;
            }
            $owed = $in - ($fee['fees'] ?? 0) - $paid;
            $rows[] = [
                'carrier' => $carrier,
                'label' => self::carrierLabel($carrier),
                'collected_all_time' => Pricing::format($in),
                'fees_all_time' => $fee['fees'] === null ? null : Pricing::format($fee['fees']),
                'fees_reported' => $fee['fees_reported'],
                'payouts_all_time' => Pricing::format($paid),
                'owed' => Pricing::format($owed),
                // Below 0: with payments recorded, the courier paid more than the cash recorded for it; with none,
                // its fees (returned parcels too) are more than the cash it collected, so the shop owes it the rest.
                'note' => $owed >= 0 ? null : ($paid > 0 ? 'paid_more_than_recorded' : 'fees_more_than_collected'),
                'last_payout_on' => $payouts[$carrier]['last'] ?? null,
            ];
        }

        return $rows;
    }

    /**
     * GET reports/cod/outstanding: COD orders shipped (or delivered) and not paid in full, oldest shipment
     * first, store currency. Rows: { number, placed_at, shipped_at, carrier, consignment_id, delivery_status,
     * cod_due, days_since_shipped }. $carrier: the latest shipment's carrier; $olderThanDays: shipped at least
     * that many days ago.
     */
    public function outstanding(?string $carrier, ?int $olderThanDays, int $perPage): LengthAwarePaginator
    {
        return $this->outstandingQuery($carrier, $olderThanDays)->paginate($perPage)->withQueryString()
            ->through(fn (Order $order) => $this->outstandingRow($order));
    }

    /** Every outstanding row (the CSV). */
    public function outstandingAll(?string $carrier, ?int $olderThanDays): array
    {
        return $this->outstandingQuery($carrier, $olderThanDays)->limit(10000)->get()->map(fn (Order $order) => $this->outstandingRow($order))->all();
    }

    /** { orders, amount }: the whole outstanding cash (store currency). */
    private function outstandingTotals(): array
    {
        $orders = $this->outstandingOrders()->get(['id', 'payment_method', 'payment_status', 'cod_due', 'grand_total', 'gift_card_amount', 'reward_points_amount']);

        return ['orders' => $orders->count(), 'amount' => Pricing::format($orders->sum(fn (Order $order) => $order->codDueCents()))];
    }

    /**
     * COD orders that left the warehouse (not cancelled or closed) with cash still to collect. A parcel that came
     * back (its latest shipment returned or cancelled by the courier) brings in no cash, so it is not counted.
     */
    private function outstandingOrders(): Builder
    {
        $latest = Shipment::query()->selectRaw('max(id)')->groupBy('order_id');
        $cameBack = Shipment::query()->select('order_id')->whereIn('id', $latest)->whereIn('delivery_status', ['returned', 'cancelled']);

        return Order::query()->where('orders.payment_method', 'cod')->whereIn('orders.status', ['shipped', 'delivered'])
            ->whereNotIn('orders.id', $cameBack)
            ->where('orders.currency', Currency::store())
            ->where(fn ($query) => $query->where('orders.cod_due', '>', 0)
                // Orders from before phase 14 have no cod_due: everything is due until invoiced (Order::codDueCents()).
                ->orWhere(fn ($old) => $old->whereNull('orders.cod_due')->whereIn('orders.payment_status', ['unpaid', 'review'])));
    }

    private function outstandingQuery(?string $carrier, ?int $olderThanDays): Builder
    {
        $latest = Shipment::query()->selectRaw('order_id, max(id) as id')->groupBy('order_id');

        return $this->outstandingOrders()
            ->leftJoinSub($latest, 'latest_shipment', 'latest_shipment.order_id', '=', 'orders.id')
            ->leftJoin('shipments', 'shipments.id', '=', 'latest_shipment.id')
            ->when($carrier, fn ($query) => $query->where('shipments.carrier', $carrier))
            ->when($olderThanDays !== null, fn ($query) => $query->where('shipments.created_at', '<=', now()->subDays($olderThanDays)))
            ->select(['orders.id', 'orders.number', 'orders.placed_at', 'orders.payment_method', 'orders.payment_status', 'orders.cod_due',
                'orders.grand_total', 'orders.gift_card_amount', 'orders.reward_points_amount', 'shipments.created_at as shipped_at',
                'shipments.carrier as shipment_carrier', 'shipments.courier_consignment_id as shipment_consignment_id',
                'shipments.delivery_status as shipment_delivery_status'])
            ->orderByRaw('coalesce(shipments.created_at, orders.placed_at)')->orderBy('orders.id');
    }

    private function outstandingRow(Order $order): array
    {
        $shipped = $order->shipped_at ? CarbonImmutable::parse($order->shipped_at, 'UTC') : null;

        return [
            'number' => $order->number,
            'placed_at' => $order->placed_at?->toIso8601ZuluString(),
            'shipped_at' => $shipped?->toIso8601ZuluString(),
            'carrier' => $order->shipment_carrier,
            'consignment_id' => $order->shipment_consignment_id,
            'delivery_status' => $order->shipment_delivery_status,
            'cod_due' => Pricing::format($order->codDueCents()),
            'days_since_shipped' => $shipped ? (int) floor($shipped->diffInDays(now())) : null,
        ];
    }

    /** Shipments of COD orders. */
    private function codShipments(): Builder
    {
        return Shipment::query()->join('orders', 'orders.id', '=', 'shipments.order_id')->where('orders.payment_method', 'cod');
    }

    /** Cash collected on delivery (cents, store currency) by who collected it (courier code or "staff"), within $bounds or all time. */
    private function collections(?array $bounds): array
    {
        $invoices = Invoice::with('order:id,currency,payment_method,payment_provider,payment_reference,payment_details,gift_card_amount,reward_points_amount')
            ->where('kind', 'cod_collection')
            ->whereHas('order', fn ($query) => $query->where('currency', Currency::store()))
            ->when($bounds, fn ($query) => $query->whereBetween('created_at', $bounds))
            ->orderBy('id')->get(['id', 'order_id', 'amount', 'kind', 'collected_via', 'admin_id', 'created_at']);
        $parts = $this->parts($invoices);
        $sums = [];
        foreach ($invoices as $invoice) {
            $via = $invoice->collected_via ?: 'staff';
            $sums[$via] = ($sums[$via] ?? 0) + ($parts[$invoice->id]['cash:'.$via] ?? 0);
        }

        return $sums;
    }

    /** The fees couriers reported per parcel: carrier → { cents, parcels } (only parcels with a fee). */
    private function parcelFees(?array $bounds): array
    {
        return $this->codShipments()->where('orders.currency', Currency::store())
            ->whereIn('shipments.delivery_status', self::FEE_STATUSES)->whereNotNull('shipments.courier_fee_cents')
            ->when($bounds, fn ($query) => $query->whereRaw('coalesce(shipments.status_updated_at, shipments.created_at) between ? and ?', $bounds))
            ->selectRaw('shipments.carrier as carrier, sum(shipments.courier_fee_cents) as cents, count(*) as parcels')
            ->groupBy('shipments.carrier')->toBase()->get()
            ->mapWithKeys(fn ($row) => [$row->carrier => ['cents' => (int) $row->cents, 'parcels' => (int) $row->parcels]])->all();
    }

    /** Courier payments (store currency): carrier → { amount, fees|null, last } (cents), between the dates or all time. */
    private function payouts(?string $from, ?string $to): array
    {
        return CourierPayout::query()->where('currency', Currency::store())
            ->when($from, fn ($query) => $query->whereBetween('received_on', [$from, $to]))
            ->selectRaw('carrier, sum(amount) as amount, sum(fees) as fees, count(fees) as with_fees, max(received_on) as last')
            ->groupBy('carrier')->toBase()->get()
            ->mapWithKeys(fn ($row) => [$row->carrier => [
                'amount' => Pricing::toCents((string) $row->amount),
                'fees' => (int) $row->with_fees > 0 ? Pricing::toCents((string) $row->fees) : null,
                'last' => $row->last ? substr((string) $row->last, 0, 10) : null,
            ]])->all();
    }

    /** { fees (cents) | null when nobody reported any, fees_reported }: per-parcel fees plus fees typed into payments. */
    private function feesOf(?array $parcels, ?array $payouts): array
    {
        $reported = $parcels !== null || ($payouts['fees'] ?? null) !== null;

        return ['fees' => $reported ? ($parcels['cents'] ?? 0) + ($payouts['fees'] ?? 0) : null, 'fees_reported' => $reported];
    }

    /**
     * Each invoice's amount split into channels (cents): [invoice id => [channel => cents]]. The order's gift card
     * and reward points amounts are carved off its first non-advance invoices (earlier ones outside the range count too).
     *
     * @param  Collection<int, Invoice>  $invoices  with their order
     */
    private function parts(Collection $invoices): array
    {
        $carved = [];
        $orders = $invoices->map->order->filter(fn (?Order $order) => $order
            && Pricing::toCents($order->gift_card_amount ?? 0) + Pricing::toCents($order->reward_points_amount ?? 0) > 0)->keyBy('id');
        if ($orders->isNotEmpty()) {
            $all = Invoice::whereIn('order_id', $orders->keys())->where(fn ($query) => $query->whereNull('kind')->orWhere('kind', '!=', 'advance'))
                ->orderBy('id')->get(['id', 'order_id', 'amount']);
            foreach ($all->groupBy('order_id') as $orderId => $list) {
                $gift = Pricing::toCents($orders[$orderId]->gift_card_amount ?? 0);
                $points = Pricing::toCents($orders[$orderId]->reward_points_amount ?? 0);
                foreach ($list as $invoice) {
                    $left = Pricing::toCents($invoice->amount);
                    $g = min($gift, $left);
                    $p = min($points, $left - $g);
                    [$gift, $points] = [$gift - $g, $points - $p];
                    $carved[$invoice->id] = ['gift_card' => $g, 'reward_points' => $p];
                }
            }
        }

        $parts = [];
        foreach ($invoices as $invoice) {
            $cut = $carved[$invoice->id] ?? ['gift_card' => 0, 'reward_points' => 0];
            $rest = Pricing::toCents($invoice->amount) - $cut['gift_card'] - $cut['reward_points'];
            $parts[$invoice->id] = [...$cut, $this->channelOf($invoice) => $rest];
        }

        return $parts;
    }

    /** The channel an invoice's money came through (the gift card / reward points part aside). */
    private function channelOf(Invoice $invoice): string
    {
        $order = $invoice->order;

        return match (true) {
            $invoice->kind === 'advance' => 'advance',
            $invoice->kind === 'cod_collection' => 'cash:'.($invoice->collected_via ?: 'staff'),
            // A payment the provider confirmed (it left a reference); a COD order's other invoices are staff's.
            $order !== null && $order->payment_method !== 'cod' && in_array($order->payment_provider, self::PROVIDERS, true)
                && filled($order->payment_reference) => $order->payment_provider === 'sslcommerz'
                    ? 'sslcommerz:'.(SslCommerzPayments::methodCode($order) ?? 'other') : $order->payment_provider,
            default => 'other',
        };
    }

    /** online (providers and COD advances), cod_cash (cash:*), or other (gift cards, reward points, staff invoices). */
    private static function groupOf(string $channel): string
    {
        return match (true) {
            str_starts_with($channel, 'cash:') => 'cod_cash',
            in_array($channel, ['gift_card', 'reward_points', 'other'], true) => 'other',
            default => 'online',
        };
    }

    public static function channelLabel(string $channel): string
    {
        return match (true) {
            $channel === 'stripe' => 'Card (Stripe)',
            $channel === 'paypal' => 'PayPal',
            str_starts_with($channel, 'sslcommerz:') => (self::SSLCOMMERZ_LABELS[substr($channel, 11)] ?? 'Other').' (SSLCommerz)',
            $channel === 'advance' => 'Cash on delivery advances (paid online)',
            $channel === 'cash:staff' => 'Cash collected by staff',
            str_starts_with($channel, 'cash:') => 'Cash collected by '.self::carrierLabel(substr($channel, 5)),
            $channel === 'gift_card' => 'Gift cards',
            $channel === 'reward_points' => 'Reward points',
            default => 'Recorded by staff (no payment provider)',
        };
    }

    public static function carrierLabel(string $carrier): string
    {
        return Shipment::CARRIERS[$carrier][0] ?? ucfirst($carrier);
    }
}
