<?php

namespace App\Services;

use App\Models\CreditMemo;
use App\Models\Customer;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
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
        $days = $this->orders($from, $to)
            ->selectRaw('date(placed_at) as day, count(*) as orders, sum(discount_total) as discounts, '
                .'sum(shipping_total) as shipping, sum(tax_total) as tax, sum(grand_total) as gross')
            ->groupBy('day')->get();
        $units = (int) OrderItem::whereIn('order_id', $this->orders($from, $to)->select('id'))->sum('quantity');
        $refundDays = CreditMemo::whereBetween('created_at', $this->bounds($from, $to))
            ->selectRaw('date(created_at) as day, sum(total) as refunds')->groupBy('day')->pluck('refunds', 'day');

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
            ->selectRaw('product_id, max(name) as name, max(sku) as sku, sum(quantity) as units, sum(line_total) as revenue')
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
            ->selectRaw('customer_id, count(*) as orders, sum(grand_total) as spent')
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

    /** [{ code, uses, discount_total }] - most used first. (A free-shipping coupon's discount is 0.00: it lowers shipping, not the merchandise.) */
    public function coupons(CarbonImmutable $from, CarbonImmutable $to): array
    {
        return $this->orders($from, $to)->whereNotNull('coupon_code')
            ->selectRaw('coupon_code, count(*) as uses, sum(discount_total) as discount_total')
            ->groupBy('coupon_code')->orderByDesc('uses')->orderBy('coupon_code')->get()
            ->map(fn ($row) => [
                'code' => $row->coupon_code,
                'uses' => (int) $row->uses,
                'discount_total' => Pricing::format(Pricing::toCents((string) $row->discount_total)),
            ])->all();
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
