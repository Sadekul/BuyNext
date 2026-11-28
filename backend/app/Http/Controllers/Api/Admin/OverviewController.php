<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Admin;
use App\Models\CreditMemo;
use App\Models\Customer;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderReturn;
use App\Models\Product;
use App\Models\Review;
use App\Services\Pricing;
use App\Services\Reports;
use App\Services\SearchTerms;
use App\Services\Settings;
use App\Support\Currency;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * GET /api/admin/v1/overview - the dashboard's numbers, computed by the
 * database (SUM/COUNT), not in PHP. Phase 7: Magento's dashboard blocks
 * (revenue chart, bestsellers, new customers, top search terms, to-do
 * counts), each only for admins with the matching *.view permission.
 */
class OverviewController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $admin = $request->user();
        $can = fn (string $key) => $admin instanceof Admin && $admin->hasPermission($key);
        $threshold = (int) app(Settings::class)->get('low_stock_threshold');
        $data = [];

        // Phase 7: each block only with its permission (dashboard.view alone shows just the frame).
        if ($can('products.view')) {
            $data['products'] = [
                'total' => Product::count(),
                'active' => Product::active()->count(),
                'out_of_stock' => Product::where('stock_quantity', 0)->count(),
                'low_stock' => Product::whereBetween('stock_quantity', [1, $threshold - 1])->count(),
                'inventory_value' => Pricing::format(Pricing::toCents((string) (Product::sum(DB::raw('price * stock_quantity')) ?? 0))),
            ];
            $data['low_stock_products'] = Product::with('category')
                ->where('stock_quantity', '<', $threshold)
                ->orderBy('stock_quantity')->orderBy('id')
                ->limit(8)->get()
                ->map(fn (Product $product) => [
                    'id' => $product->id,
                    'name' => $product->name,
                    'sku' => $product->sku,
                    'category' => $product->category->slug,
                    'stock_quantity' => $product->stock_quantity,
                    'thumbnail_url' => $product->thumbnail_url,
                ]);
        }

        if ($can('orders.view')) {
            // Cancelled orders aren't revenue, and refunds (credit memos) are taken off it.
            // Phase 12: revenue in the store currency only (orders from before a currency switch aren't added in).
            $counted = Order::where('status', '!=', 'cancelled')->where('currency', Currency::store());
            $revenueCents = Pricing::toCents((string) ($counted->clone()->sum('grand_total') ?? 0))
                - Pricing::toCents((string) (CreditMemo::whereHas('order', fn ($q) => $q->where('currency', Currency::store()))->sum('total') ?? 0));
            $countedOrders = $counted->clone()->count();
            $byStatus = Order::selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');

            $data['orders'] = [
                'total' => Order::count(),
                'revenue' => Pricing::format($revenueCents),
                'units_sold' => (int) OrderItem::whereHas('order', fn ($q) => $q->where('status', '!=', 'cancelled'))->sum('quantity'),
                'average_order' => Pricing::format($countedOrders ? (int) round($revenueCents / $countedOrders) : 0),
                'by_status' => collect(Order::STATUSES)->mapWithKeys(fn ($status) => [$status => (int) ($byStatus[$status] ?? 0)]),
            ];
            $data['latest_orders'] = Order::with(['items', 'customer'])->latest('id')->limit(5)->get()
                ->map(fn (Order $order) => [
                    'number' => $order->number,
                    'customer_name' => $order->customer
                        ? trim("{$order->customer->first_name} {$order->customer->last_name}")
                        : trim(($order->shipping_address['first_name'] ?? '').' '.($order->shipping_address['last_name'] ?? '')),
                    'email' => $order->email,
                    'items' => $order->itemCount(),
                    'total' => $order->grand_total,
                    'currency' => $order->currencyCode(), // phase 12
                    'status' => $order->status,
                    'placed_at' => $order->placed_at?->toIso8601ZuluString(),
                ]);
            $data['revenue_chart'] = $this->revenueChart();
        }

        if ($can('customers.view')) {
            $data['customers'] = ['total' => Customer::count()];
            $data['new_customers'] = Customer::latest('id')->limit(5)->get()->map(fn (Customer $customer) => [
                'id' => $customer->id,
                'name' => trim("{$customer->first_name} {$customer->last_name}"),
                'email' => $customer->email,
                'created_at' => $customer->created_at?->toIso8601ZuluString(),
            ]);
        }

        if ($can('reports.view')) {
            $data['bestsellers'] = OrderItem::query()
                ->whereHas('order', fn ($q) => $q->where('status', '!=', 'cancelled'))
                ->selectRaw('product_id, MAX(name) as name, MAX(sku) as sku, SUM(quantity) as units, '
                    .'SUM(CASE WHEN order_id IN (SELECT id FROM orders WHERE currency = ?) THEN line_total ELSE 0 END) as revenue', [Currency::store()])
                ->groupBy('product_id')->orderByDesc('units')->orderBy('product_id')->limit(5)->get()
                ->map(fn ($row) => [
                    'product_id' => $row->product_id,
                    'name' => $row->name,
                    'sku' => $row->sku,
                    'units' => (int) $row->units,
                    'revenue' => Pricing::format(Pricing::toCents((string) $row->revenue)),
                ]);
            $data['top_search_terms'] = Schema::hasTable('search_terms') ? app(SearchTerms::class)->top(5) : [];
        }

        // To-do counts, each with the permission of the page it links to.
        $todo = [];
        if ($can('orders.view')) {
            // Phase 12: a payment held for review (SSLCommerz risk check) also waits for staff to invoice it.
            $todo['orders_to_invoice'] = Order::whereIn('payment_status', ['unpaid', 'review'])->whereNotIn('status', ['cancelled', 'closed'])->count();
            $todo['orders_to_ship'] = Order::where('status', 'processing')->doesntHave('shipments')->count();
        }
        if ($can('returns.view')) {
            $todo['return_requests'] = OrderReturn::where('status', 'requested')->count();
        }
        if ($can('reviews.view')) {
            $todo['pending_reviews'] = Review::where('status', 'pending')->count();
        }
        if ($can('products.view')) {
            $todo['low_stock_products'] = Product::where('stock_quantity', '<', $threshold)->count();
        }
        $data['todo'] = (object) $todo;
        $data['low_stock_threshold'] = $threshold;
        $data['currency'] = Currency::api(); // phase 12: the money above is in the store currency
        $data['blocks'] = array_values(array_diff(array_keys($data), ['todo', 'low_stock_threshold', 'currency']));

        return response()->json(['data' => $data]);
    }

    /**
     * The last 30 days (today included): [{ date, orders, revenue }], zeros for quiet days.
     * Phase 21: days in the store time zone (UTC by default), found in PHP (Reports::localDate()).
     */
    private function revenueChart(): array
    {
        $reports = app(Reports::class);
        $today = $reports->today();
        $from = $today->subDays(29);
        $days = [];
        $orders = Order::where('status', '!=', 'cancelled')->where('currency', Currency::store())
            ->where('placed_at', '>=', $from->utc()->toDateTimeString())->toBase()->get(['placed_at', 'grand_total']);
        foreach ($orders as $order) {
            $day = $reports->localDate($order->placed_at)->toDateString();
            $days[$day] ??= ['orders' => 0, 'revenue' => 0];
            $days[$day]['orders']++;
            $days[$day]['revenue'] += Pricing::toCents((string) $order->grand_total);
        }

        $chart = [];
        for ($day = $from; $day <= $today; $day = $day->addDay()) {
            $row = $days[$day->toDateString()] ?? ['orders' => 0, 'revenue' => 0];
            $chart[] = ['date' => $day->toDateString(), 'orders' => $row['orders'], 'revenue' => Pricing::format($row['revenue'])];
        }

        return $chart;
    }
}
