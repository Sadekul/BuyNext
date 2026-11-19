<?php

namespace App\Services;

use App\Models\Coupon;
use App\Models\CouponRedemption;
use App\Models\CreditMemo;
use App\Models\Customer;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\RewardTransaction;
use App\Models\WishlistItem;
use App\Support\Currency;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The admin's reports (Magento's Reports menu). The database does the adding
 * up (SUM / COUNT ... GROUP BY); PHP only puts the rows into periods.
 *
 * Counted orders: every order that isn't cancelled, by the date it was placed.
 * Refunds: credit memos by the date they were created (when the money went back).
 * Dates are whole days in the store time zone (UTC for now), both ends included.
 */
class Reports
{
    public function __construct(private Settings $settings) {}

    /**
     * { totals: { orders, units, gross, discounts, shipping, tax, refunds, net, average_order },
     *   series: [{ period, orders, gross, refunds, net }] } - every period in the range, zeros included.
     * gross = what customers were charged (grand totals); net = gross − refunds;
     * average_order = net / orders (like the dashboard).
     */
    public function sales(CarbonImmutable $from, CarbonImmutable $to, string $groupBy): array
    {
        // Phase 12: money is added up per currency, never across currencies: the totals and series are the
        // store currency's; other_currencies lists the rest (orders placed before a currency switch).
        $store = Currency::store();
        $days = $this->orders($from, $to)->where('currency', $store)
            ->selectRaw('date(placed_at) as day, count(*) as orders, sum(discount_total) as discounts, '
                .'sum(shipping_total) as shipping, sum(tax_total) as tax, sum(grand_total) as gross')
            ->groupBy('day')->get();
        $units = (int) OrderItem::whereIn('order_id', $this->orders($from, $to)->select('id'))->sum('quantity');
        $memos = fn () => CreditMemo::whereBetween('credit_memos.created_at', $this->bounds($from, $to))
            ->join('orders', 'orders.id', '=', 'credit_memos.order_id');
        $refundDays = $memos()->where('orders.currency', $store)
            ->selectRaw('date(credit_memos.created_at) as day, sum(credit_memos.total) as refunds')->groupBy('day')->pluck('refunds', 'day');
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
        foreach ($days as $day) {
            $period = $this->periodOf(CarbonImmutable::parse($day->day), $groupBy);
            $series[$period]['orders'] += (int) $day->orders;
            $series[$period]['gross'] += Pricing::toCents((string) $day->gross);
            $totals['orders'] += (int) $day->orders;
            foreach (['discounts', 'shipping', 'tax', 'gross'] as $field) {
                $totals[$field] += Pricing::toCents((string) $day->{$field});
            }
        }
        foreach ($refundDays as $day => $refunds) {
            $period = $this->periodOf(CarbonImmutable::parse($day), $groupBy);
            $series[$period]['refunds'] += Pricing::toCents((string) $refunds);
            $totals['refunds'] += Pricing::toCents((string) $refunds);
        }
        $net = $totals['gross'] - $totals['refunds'];

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
        ];
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
        $rows = RewardTransaction::whereBetween('created_at', $this->bounds($from, $to))
            ->selectRaw('date(created_at) as day, type, sum(points) as points')->groupBy('day', 'type')->get();
        $series = [];
        foreach ($this->periods($from, $to, $groupBy) as $period) {
            $series[$period] = ['period' => $period, 'issued' => 0, 'spent' => 0];
        }
        $totals = ['issued' => 0, 'spent' => 0, 'returned' => 0, 'reversed' => 0, 'adjusted' => 0];
        foreach ($rows as $row) {
            $period = $this->periodOf(CarbonImmutable::parse($row->day), $groupBy);
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

    /** The first and last second of the range, as the database compares them. */
    private function bounds(CarbonImmutable $from, CarbonImmutable $to): array
    {
        return [$from->startOfDay()->toDateTimeString(), $to->endOfDay()->toDateTimeString()];
    }

    /**
     * Every period from $from to $to: days "2026-11-10", weeks by their
     * Monday "2026-11-09", months "2026-11".
     */
    private function periods(CarbonImmutable $from, CarbonImmutable $to, string $groupBy): array
    {
        $periods = [];
        for ($day = $from; $day <= $to; $day = $day->addDay()) {
            $periods[$this->periodOf($day, $groupBy)] = true;
        }

        return array_keys($periods);
    }

    private function periodOf(CarbonImmutable $day, string $groupBy): string
    {
        return match ($groupBy) {
            'week' => $day->startOfWeek(CarbonImmutable::MONDAY)->toDateString(),
            'month' => $day->format('Y-m'),
            default => $day->toDateString(),
        };
    }
}
