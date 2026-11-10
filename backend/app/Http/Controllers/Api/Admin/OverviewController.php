<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\CreditMemo;
use App\Models\Customer;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Services\Pricing;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/** GET /api/admin/v1/overview - the dashboard's numbers, computed by the database (SUM/COUNT), not in PHP. */
class OverviewController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $threshold = config('buynest.store.low_stock_threshold');

        // Cancelled orders aren't revenue, and refunds (credit memos) are taken off it.
        $counted = Order::where('status', '!=', 'cancelled');
        $revenueCents = Pricing::toCents((string) ($counted->clone()->sum('grand_total') ?? 0))
            - Pricing::toCents((string) (CreditMemo::sum('total') ?? 0));
        $countedOrders = $counted->clone()->count();
        $byStatus = Order::selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');

        return response()->json(['data' => [
            'products' => [
                'total' => Product::count(),
                'active' => Product::active()->count(),
                'out_of_stock' => Product::where('stock_quantity', 0)->count(),
                'low_stock' => Product::whereBetween('stock_quantity', [1, $threshold - 1])->count(),
                'inventory_value' => Pricing::format(Pricing::toCents((string) (Product::sum(DB::raw('price * stock_quantity')) ?? 0))),
            ],
            'orders' => [
                'total' => Order::count(),
                'revenue' => Pricing::format($revenueCents),
                'units_sold' => (int) OrderItem::whereHas('order', fn ($q) => $q->where('status', '!=', 'cancelled'))->sum('quantity'),
                'average_order' => Pricing::format($countedOrders ? (int) round($revenueCents / $countedOrders) : 0),
                'by_status' => collect(Order::STATUSES)->mapWithKeys(fn ($status) => [$status => (int) ($byStatus[$status] ?? 0)]),
            ],
            'customers' => ['total' => Customer::count()],
            'low_stock_products' => Product::with('category')
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
                ]),
            'latest_orders' => Order::with(['items', 'customer'])->latest('id')->limit(5)->get()
                ->map(fn (Order $order) => [
                    'number' => $order->number,
                    'customer_name' => $order->customer
                        ? trim("{$order->customer->first_name} {$order->customer->last_name}")
                        : trim(($order->shipping_address['first_name'] ?? '').' '.($order->shipping_address['last_name'] ?? '')),
                    'email' => $order->email,
                    'items' => $order->itemCount(),
                    'total' => $order->grand_total,
                    'status' => $order->status,
                    'placed_at' => $order->placed_at?->toIso8601ZuluString(),
                ]),
            'low_stock_threshold' => $threshold,
        ]]);
    }
}
