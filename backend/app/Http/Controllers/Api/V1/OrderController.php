<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\PlaceOrderRequest;
use App\Http\Resources\InvoiceResource;
use App\Http\Resources\OrderResource;
use App\Models\Invoice;
use App\Models\Order;
use App\Services\Checkout;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/** Placing orders (guests and customers), order history, and the guest lookup. */
class OrderController extends Controller
{
    /** POST /api/v1/orders → 201 { data: OrderResource }. Guests, or customers with their Bearer token. */
    public function store(PlaceOrderRequest $request, Checkout $checkout): JsonResponse
    {
        $data = $request->validated();
        $data['shipping_address'] = $request->address('shipping_address');
        $data['billing_address'] = $request->address('billing_address');

        $order = $checkout->place($data, $request->customer());

        return (new OrderResource($order))->response()->setStatusCode(201);
    }

    /** GET /api/v1/orders - the signed-in customer's orders, newest first. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:50']]);

        $orders = Order::where('customer_id', $request->user()->id)
            ->with(['items', ...Order::DOCUMENTS])
            ->latest('id')
            ->paginate($data['per_page'] ?? 10)
            ->withQueryString();

        return OrderResource::collection($orders);
    }

    /** GET /api/v1/orders/{number} - someone else's order is "not found" (never "forbidden": that would confirm it exists). */
    public function show(Request $request, string $number): OrderResource|JsonResponse
    {
        $order = Order::where('number', strtoupper($number))
            ->where('customer_id', $request->user()->id)
            ->with(['items', 'history', ...Order::DOCUMENTS])
            ->first();

        return $order ? new OrderResource($order) : response()->json(['message' => 'Order not found.'], 404);
    }

    /**
     * GET /api/v1/orders/{number}/invoices/{invoice} - for the printable invoice page.
     * Only the customer's own orders; anything else is "not found".
     */
    public function invoice(Request $request, string $number, string $invoice): InvoiceResource|JsonResponse
    {
        $found = Invoice::where('number', strtoupper($invoice))
            ->whereHas('order', fn ($q) => $q->where('number', strtoupper($number))->where('customer_id', $request->user()->id))
            ->with(['order.items', 'order.invoices', 'order.creditMemos'])
            ->first();

        return $found ? (new InvoiceResource($found))->forCustomer() : response()->json(['message' => 'Invoice not found.'], 404);
    }

    /** POST /api/v1/orders/lookup { number, email } - for guests. Same 404 whichever part is wrong. */
    public function lookup(Request $request): OrderResource|JsonResponse
    {
        $data = $request->validate([
            'number' => ['required', 'string', 'max:20'],
            'email' => ['required', 'string', 'email', 'max:190'],
        ]);

        $order = Order::where('number', strtoupper(trim($data['number'])))->with(['items', 'history', ...Order::DOCUMENTS])->first();

        return $order && mb_strtolower($order->email) === mb_strtolower(trim($data['email']))
            ? new OrderResource($order)
            : response()->json(['message' => 'We couldn\'t find an order with that number and email.'], 404);
    }
}
