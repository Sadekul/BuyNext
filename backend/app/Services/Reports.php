<?php

namespace App\Services;

use App\Models\Coupon;
use App\Models\CouponRedemption;
use App\Models\CreditMemo;
use App\Models\Customer;
use App\Models\DeliveryZone;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\RewardTransaction;
use App\Models\WishlistItem;
use App\Services\Payments\SslCommerzPayments;
use App\Support\Currency;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The admin's reports (Magento's Reports menu). The database does the adding
 * up (SUM / COUNT ... GROUP BY); PHP only puts the rows into periods.
 *
 * Counted orders: every order that isn't cancelled, by the date it was placed.
 * Refunds: credit memos by the date they were created (when the money went back).
 * Dates are whole days in the store time zone, both ends included.
 *
 * Phase 21: the store time zone is a setting (store_timezone, default UTC).
 * SQL compares whole UTC instants only (bounds()); rows are put into days in
 * PHP (localDate()), never with CONVERT_TZ (MySQL's zone tables may be
 * missing). With UTC every answer is the same as before.
 */
class Reports
{
    public function __construct(private Settings $settings) {}

    /**
     * { totals: { orders, units, gross, discounts, shipping, tax, refunds, net, average_order },
     *   series: [{ period, orders, gross, refunds, net }] } - every period in the range, zeros included.
     * gross = what customers were charged (grand totals); net = gross − refunds;
     * average_order = net / orders (like the dashboard).
     *
     * Phase 21: by_payment_method [{ method, label, orders, gross, refunds, net }] and
     * by_delivery_zone [{ zone_code|null, name, orders, gross, refunds, net }], both most gross first,
     * both in the store currency and adding up to the totals. Refunds go to the order's method / zone.
     */
    public function sales(CarbonImmutable $from, CarbonImmutable $to, string $groupBy): array
    {
        // Phase 12: money is added up per currency, never across currencies: the totals and series are the
        // store currency's; other_currencies lists the rest (orders placed before a currency switch).
        $store = Currency::store();
        // Phase 21: one row per order (the day is found in PHP, in the store time zone).
        $orders = $this->orders($from, $to)->where('currency', $store)
            ->get(['id', 'placed_at', 'discount_total', 'shipping_total', 'tax_total', 'grand_total', 'payment_method', 'payment_provider',
                'payment_details', 'delivery_zone_code']);
        $units = (int) OrderItem::whereIn('order_id', $this->orders($from, $to)->select('id'))->sum('quantity');
        $memos = fn () => CreditMemo::whereBetween('credit_memos.created_at', $this->bounds($from, $to))
            ->join('orders', 'orders.id', '=', 'credit_memos.order_id');
        $refundRows = Order::query()->join('credit_memos', 'credit_memos.order_id', '=', 'orders.id')
            ->whereBetween('credit_memos.created_at', $this->bounds($from, $to))->where('orders.currency', $store)
            ->get(['orders.id', 'orders.payment_method', 'orders.payment_provider', 'orders.payment_details', 'orders.delivery_zone_code',
                'credit_memos.created_at as memo_created_at', 'credit_memos.total as memo_total']);
        $otherOrders = $this->orders($from, $to)->where('currency', '!=', $store)
            ->selectRaw('currency, count(*) as orders, sum(grand_total) as gross')->groupBy('currency')->get()->keyBy('currency');
        $otherRefunds = $memos()->where('orders.currency', '!=', $store)
            ->selectRaw('orders.currency as currency, sum(credit_memos.total) as refunds')->groupBy('orders.currency')->pluck('refunds', 'currency');
        $others = [];
        foreach ($otherOrders->keys()->merge($otherRefunds->keys())->unique()->sort()->values() as $code) {
            $gross = Pricing::toCents((string) ($otherOrders[$code]->gross ?? 0));
            $refunds = Pricing::toCents((string) ($otherRefunds[$code] ?? 0));
            $others[] = ['currency' => $code, 'orders' => (int) ($otherOrders[$code]->orders ?? 0), 'gross' => Pricing::format($gross),
                'refunds' => Pricing::format($refunds), 'net' => Pricing::format($gross - $refunds)];
        }

        $series = [];
        foreach ($this->periods($from, $to, $groupBy) as $period) {
            $series[$period] = ['period' => $period, 'orders' => 0, 'gross' => 0, 'refunds' => 0];
        }
        $totals = ['orders' => 0, 'discounts' => 0, 'shipping' => 0, 'tax' => 0, 'gross' => 0, 'refunds' => 0];
        $methods = [];
        $zones = [];
        $add = function (array &$buckets, ?string $key, int $orders, int $gross, int $refunds) {
            $bucket = $buckets[$key ?? ''] ?? ['key' => $key, 'orders' => 0, 'gross' => 0, 'refunds' => 0];
            $bucket['orders'] += $orders;
            $bucket['gross'] += $gross;
            $bucket['refunds'] += $refunds;
            $buckets[$key ?? ''] = $bucket;
        };
        foreach ($orders as $order) {
            $period = $this->periodOf($this->localDate($order->placed_at), $groupBy);
            $gross = Pricing::toCents((string) $order->grand_total);
            $series[$period]['orders']++;
            $series[$period]['gross'] += $gross;
            $totals['orders']++;
            $totals['discounts'] += Pricing::toCents((string) $order->discount_total);
            $totals['shipping'] += Pricing::toCents((string) $order->shipping_total);
            $totals['tax'] += Pricing::toCents((string) $order->tax_total);
            $totals['gross'] += $gross;
            $add($methods, $this->methodOf($order), 1, $gross, 0);
            $add($zones, $order->delivery_zone_code, 1, $gross, 0);
        }
        foreach ($refundRows as $row) {
            $period = $this->periodOf($this->localDate($row->memo_created_at), $groupBy);
            $refunds = Pricing::toCents((string) $row->memo_total);
            $series[$period]['refunds'] += $refunds;
            $totals['refunds'] += $refunds;
            $add($methods, $this->methodOf($row), 0, 0, $refunds);
            $add($zones, $row->delivery_zone_code, 0, 0, $refunds);
        }
        $net = $totals['gross'] - $totals['refunds'];
        $zoneNames = DeliveryZone::pluck('name', 'code');

        return [
            'currency' => $store, // phase 12
            'other_currencies' => $others,
            'totals' => [
                'orders' => $totals['orders'],
                'units' => $units,
                'gross' => Pricing::format($totals['gross']),
                'discounts' => Pricing::format($totals['discounts']),
                'shipping' => Pricing::format($totals['shipping']),
                'tax' => Pricing::format($totals['tax']),
                'refunds' => Pricing::format($totals['refunds']),
                'net' => Pricing::format($net),
                'average_order' => Pricing::format($totals['orders'] ? (int) round($net / $totals['orders']) : 0),
            ],
            'series' => array_values(array_map(fn (array $row) => [
                'period' => $row['period'],
                'orders' => $row['orders'],
                'gross' => Pricing::format($row['gross']),
                'refunds' => Pricing::format($row['refunds']),
                'net' => Pricing::format($row['gross'] - $row['refunds']),
            ], $series)),
            // Phase 21.
            'by_payment_method' => $this->breakdown($methods, fn (array $row) => ['method' => $row['key'], 'label' => $this->methodLabel($row['key'])]),
            'by_delivery_zone' => $this->breakdown($zones, fn (array $row) => [
                'zone_code' => $row['key'],
                'name' => $row['key'] === null ? self::NO_ZONE : ($zoneNames[$row['key']] ?? $row['key']),
            ]),
        ];
    }

    /** Phase 21: by_delivery_zone's name for orders without a zone. */
    public const NO_ZONE = 'No zone (outside Bangladesh or a free-text address)';

    /**
     * Phase 21: the method an order is counted under: its payment_method, except SSLCommerz orders, which use
     * the wallet or card they were paid with ("sslcommerz:bkash", "sslcommerz:card"; "sslcommerz:other" when unknown).
     * A COD order whose advance went through SSLCommerz stays "cod".
     */
    public function methodOf(Order $order): string
    {
        if ($order->payment_method === 'sslcommerz') {
            return 'sslcommerz:'.(SslCommerzPayments::methodCode($order) ?? 'other');
        }

        return (string) ($order->payment_method ?: 'other');
    }

    /** Phase 21: "Cash on delivery", "bKash (SSLCommerz)", ... */
    public function methodLabel(string $method): string
    {
        if (str_starts_with($method, 'sslcommerz:')) {
            return (self::SSLCOMMERZ_LABELS[substr($method, 11)] ?? 'Other').' (SSLCommerz)';
        }

        return config("buynest.store.payment_methods.{$method}") ?? config("buynest.store.admin_payment_methods.{$method}")
            ?? self::OTHER_METHOD_LABELS[$method] ?? ucfirst(str_replace('_', ' ', $method));
    }

    private const SSLCOMMERZ_LABELS = ['bkash' => 'bKash', 'nagad' => 'Nagad', 'rocket' => 'Rocket', 'upay' => 'Upay', 'card' => 'Card',
        'internet_banking' => 'Internet banking', 'other' => 'Other'];

    private const OTHER_METHOD_LABELS = ['gift_card' => 'Gift card', 'reward_points' => 'Reward points', 'other' => 'Other'];

    /** Phase 21: buckets { key, orders, gross, refunds } (cents) → API rows, most gross first. */
    private function breakdown(array $buckets, callable $head): array
    {
        usort($buckets, fn (array $a, array $b) => [$b['gross'], $b['orders'], (string) $a['key']] <=> [$a['gross'], $a['orders'], (string) $b['key']]);

        return array_map(fn (array $row) => [
            ...$head($row),
            'orders' => $row['orders'],
            'gross' => Pricing::format($row['gross']),
            'refunds' => Pricing::format($row['refunds']),
            'net' => Pricing::format($row['gross'] - $row['refunds']),
        ], $buckets);
    }

    /**
     * Best sellers: [{ product_id, name, sku, units, revenue }], most units first.
     * revenue = the lines' totals (sale price × quantity, before the order's coupon).
     */
    public function products(CarbonImmutable $from, CarbonImmutable $to, int $limit): array
    {
        return OrderItem::whereIn('order_id', $this->orders($from, $to)->select('id'))
            // Phase 12: revenue in the store currency only (units count every order).
            ->selectRaw('product_id, max(name) as name, max(sku) as sku, sum(quantity) as units, '
                .'sum(case when order_id in (select id from orders where currency = ?) then line_total else 0 end) as revenue', [Currency::store()])
            ->groupBy('product_id')
            ->orderByDesc('units')->orderByDesc('revenue')->orderBy('product_id')
            ->limit($limit)->get()
            ->map(fn ($row) => [
                'product_id' => $row->product_id,
                'name' => $row->name,
                'sku' => $row->sku,
                'units' => (int) $row->units,
                'revenue' => Pricing::format(Pricing::toCents((string) $row->revenue)),
            ])->all();
    }

    /**
     * { new_customers, returning_customers, guest_orders, top_customers: [{ id, name, email, orders, spent }] }
     *   new_customers: confirmed accounts created in the range;
     *   returning_customers: customers who ordered in the range and have 2+ orders by its end;
     *   top_customers: the 10 who spent most in the range (grand totals).
     */
    public function customers(CarbonImmutable $from, CarbonImmutable $to): array
    {
        [$start, $end] = $this->bounds($from, $to);
        $returning = DB::query()->fromSub(
            Order::where('status', '!=', 'cancelled')->whereNotNull('customer_id')->where('placed_at', '<=', $end)
                ->select('customer_id')->groupBy('customer_id')
                ->havingRaw('count(*) >= 2')->havingRaw('max(placed_at) >= ?', [$start]),
            'returning'
        )->count();

        $top = $this->orders($from, $to)->whereNotNull('customer_id')
            // Phase 12: spent in the store currency only.
            ->selectRaw('customer_id, count(*) as orders, sum(case when currency = ? then grand_total else 0 end) as spent', [Currency::store()])
            ->groupBy('customer_id')->orderByDesc('spent')->orderBy('customer_id')->limit(10)->get();
        $customers = Customer::whereIn('id', $top->pluck('customer_id'))->get()->keyBy('id');

        return [
            'new_customers' => Customer::whereNotNull('email_verified_at')->whereBetween('created_at', [$start, $end])->count(),
            'returning_customers' => $returning,
            'guest_orders' => $this->orders($from, $to)->whereNull('customer_id')->count(),
            'top_customers' => $top->map(fn ($row) => [
                'id' => $row->customer_id,
                'name' => trim(($customers[$row->customer_id]->first_name ?? '').' '.($customers[$row->customer_id]->last_name ?? '')),
                'email' => $customers[$row->customer_id]->email ?? null,
                'orders' => (int) $row->orders,
                'spent' => Pricing::format(Pricing::toCents((string) $row->spent)),
            ])->all(),
        ];
    }

    /**
     * [{ coupon_id, code, name, automatic, uses, discount_total }] - most used first. Phase 7: from the rule uses
     * (coupon_redemptions) of the range's orders, so automatic rules (no code) are listed by name.
     * (A free-shipping rule's discount is 0.00: it lowers shipping, not the merchandise.)
     */
    public function coupons(CarbonImmutable $from, CarbonImmutable $to): array
    {
        $rows = CouponRedemption::query()
            ->whereIn('order_id', $this->orders($from, $to)->select('id'))
            // Phase 12: discounts in the store currency only.
            ->selectRaw('coupon_id, count(*) as uses, sum(case when order_id in (select id from orders where currency = ?) then discount else 0 end) as discount_total',
                [Currency::store()])
            ->groupBy('coupon_id')->get();
        $coupons = Coupon::whereIn('id', $rows->pluck('coupon_id'))->get()->keyBy('id');

        return $rows->map(fn ($row) => [
            'coupon_id' => (int) $row->coupon_id,
            'code' => $coupons[$row->coupon_id]->code ?? null,
            'name' => $coupons[$row->coupon_id]->description ?? null,
            'automatic' => (bool) ($coupons[$row->coupon_id]->auto_apply ?? false),
            'uses' => (int) $row->uses,
            'discount_total' => Pricing::format(Pricing::toCents((string) ($row->discount_total ?? 0))),
        ])->sortBy([['uses', 'desc'], fn ($a, $b) => strcmp($a['code'] ?? $a['name'] ?? '', $b['code'] ?? $b['name'] ?? '')])->values()->all();
    }

    /** Products (not deleted, any status) below the low-stock threshold, lowest stock first. */
    public function lowStock(): array
    {
        return Product::with('category')
            ->where('stock_quantity', '<', $this->lowStockThreshold())
            ->orderBy('stock_quantity')->orderBy('id')
            ->get()
            ->map(fn (Product $product) => [
                'id' => $product->id,
                'name' => $product->name,
                'sku' => $product->sku,
                'category' => $product->category?->slug,
                'status' => $product->status,
                'stock_quantity' => $product->stock_quantity,
                'thumbnail_url' => $product->thumbnail_url,
            ])->all();
    }

    public function lowStockThreshold(): int
    {
        return (int) $this->settings->get('low_stock_threshold');
    }

    /**
     * Phase 11: most wished-for products: wishlist rows added within the
     * dates, by product (most customers first). [{ product_id, name, sku,
     * thumbnail_url, customers, in_stock, availability }].
     */
    public function wishlist(CarbonImmutable $from, CarbonImmutable $to, int $limit): array
    {
        $counts = WishlistItem::whereBetween('created_at', $this->bounds($from, $to))
            ->selectRaw('product_id, COUNT(DISTINCT customer_id) AS customers')->groupBy('product_id')
            ->orderByDesc('customers')->orderBy('product_id')->limit($limit)->pluck('customers', 'product_id');
        $products = Product::withTrashed()->whereIn('id', $counts->keys())->get()->keyBy('id');

        return $counts->map(function ($customers, $id) use ($products) {
            $product = $products->get($id);

            return [
                'product_id' => (int) $id,
                'name' => $product?->name,
                'sku' => $product?->sku,
                'thumbnail_url' => $product?->thumbnail_url,
                'customers' => (int) $customers,
                'in_stock' => $product !== null && $product->availability() !== 'out_of_stock',
                'availability' => $product?->availability() ?? 'out_of_stock',
            ];
        })->values()->all();
    }

    /**
     * Phase 11: reward points issued / spent per period, totals, and what is
     * still owed (every balance now × the point value).
     */
    public function rewards(CarbonImmutable $from, CarbonImmutable $to, string $groupBy, RewardPoints $points): array
    {
        // Phase 21: one row per transaction (the day is found in PHP, in the store time zone).
        $rows = RewardTransaction::whereBetween('created_at', $this->bounds($from, $to))->toBase()->get(['created_at', 'type', 'points']);
        $series = [];
        foreach ($this->periods($from, $to, $groupBy) as $period) {
            $series[$period] = ['period' => $period, 'issued' => 0, 'spent' => 0];
        }
        $totals = ['issued' => 0, 'spent' => 0, 'returned' => 0, 'reversed' => 0, 'adjusted' => 0];
        foreach ($rows as $row) {
            $period = $this->periodOf($this->localDate($row->created_at), $groupBy);
            $sum = (int) $row->points;
            match ($row->type) {
                'earn', 'signup', 'review' => [$series[$period]['issued'] += $sum, $totals['issued'] += $sum],
                'spend' => [$series[$period]['spent'] += -$sum, $totals['spent'] += -$sum],
                'cancel_return', 'refund_return' => $totals['returned'] += $sum,
                'refund_reverse' => $totals['reversed'] += -$sum,
                default => $totals['adjusted'] += $sum,
            };
        }
        $outstanding = (int) Customer::sum('reward_points');

        return [
            'totals' => $totals,
            'series' => array_values($series),
            'outstanding_points' => $outstanding,
            'outstanding_value' => Pricing::format($points->valueCents($outstanding)),
            'point_value' => $points->pointValueString(),
        ];
    }

    /** Orders that count, placed in the range. */
    private function orders(CarbonImmutable $from, CarbonImmutable $to): Builder
    {
        return Order::where('status', '!=', 'cancelled')->whereBetween('placed_at', $this->bounds($from, $to));
    }

    /** Phase 21: the store time zone ("UTC", "Asia/Dhaka"). */
    public function timezone(): string
    {
        return $this->settings->timezone();
    }

    /** Phase 21: today in the store time zone (midnight). */
    public function today(): CarbonImmutable
    {
        return CarbonImmutable::today($this->timezone());
    }

    /** Phase 21: a YYYY-MM-DD date as a day in the store time zone. */
    public function day(string $date): CarbonImmutable
    {
        return CarbonImmutable::parse($date, $this->timezone())->startOfDay();
    }

    /**
     * The first and last second of the range, as the database compares them. Phase 21: the days are
     * the store time zone's, turned into UTC instants (the database keeps UTC).
     */
    public function bounds(CarbonImmutable $from, CarbonImmutable $to): array
    {
        $zone = $this->timezone();

        return [
            CarbonImmutable::parse($from->toDateString(), $zone)->startOfDay()->utc()->toDateTimeString(),
            CarbonImmutable::parse($to->toDateString(), $zone)->endOfDay()->utc()->toDateTimeString(),
        ];
    }

    /** Phase 21: the day (in the store time zone) of a time the database keeps in UTC. */
    public function localDate(DateTimeInterface|string $value): CarbonImmutable
    {
        $time = $value instanceof DateTimeInterface ? CarbonImmutable::instance($value) : CarbonImmutable::parse($value, 'UTC');

        return CarbonImmutable::parse($time->setTimezone($this->timezone())->toDateString(), 'UTC');
    }

    /**
     * Every period from $from to $to: days "2026-11-10", weeks by their
     * Monday "2026-11-09", months "2026-11".
     */
    public function periods(CarbonImmutable $from, CarbonImmutable $to, string $groupBy): array
    {
        $periods = [];
        for ($day = $from; $day <= $to; $day = $day->addDay()) {
            $periods[$this->periodOf($day, $groupBy)] = true;
        }

        return array_keys($periods);
    }

    public function periodOf(CarbonImmutable $day, string $groupBy): string
    {
        return match ($groupBy) {
            'week' => $day->startOfWeek(CarbonImmutable::MONDAY)->toDateString(),
            'month' => $day->format('Y-m'),
            default => $day->toDateString(),
        };
    }
}
