<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\PlaceOrderRequest;
use App\Http\Resources\InvoiceResource;
use App\Http\Resources\OrderResource;
use App\Models\Customer;
use App\Models\Invoice;
use App\Models\Order;
use App\Services\Checkout;
use App\Services\Payments\StripePayments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\ValidationException;

/** Placing orders (guests and customers), order history, and the guest lookup. */
class OrderController extends Controller
{
    /** POST /api/v1/orders → 201 { data: OrderResource } (phase 8: data.payment for card orders). Guests, or customers with their Bearer token. */
    public function store(PlaceOrderRequest $request, Checkout $checkout, StripePayments $payments): JsonResponse
    {
        $data = $request->validated();
        $data['shipping_address'] = $request->address('shipping_address');
        $data['billing_address'] = $request->address('billing_address');

        $order = $checkout->place($data, $request->customer());

        // Phase 8: a card order (Stripe on) gets its payment page now. If Stripe can't be reached the
        // order still exists, unpaid: payment.url is null, payment.error says why, and Pay now retries.
        $payment = $payments->usesStripe($order) ? $payments->startCheckout($order) : null;

        return (new OrderResource($order))->withPayment($payment)->response()->setStatusCode(201);
    }

    /**
     * POST /api/v1/orders/{number}/pay { email? } → 200 { data: OrderResource } with data.payment
     * { provider: "stripe", url, expires_at } (or url null + error when Stripe can't be reached).
     * Phase 8. Who may: the signed-in customer who owns the order, or anyone
     * with the order's email (the guest lookup's proof). Gives back the payment
     * page that's still open, or opens a new one. 422 when the order can't be
     * paid online (not card, paid, cancelled, Stripe off); 404 as the lookup.
     */
    public function pay(Request $request, string $number, StripePayments $payments): OrderResource|JsonResponse
    {
        $data = $request->validate(['email' => ['nullable', 'string', 'email', 'max:190']]);
        $customer = $request->user() instanceof Customer ? $request->user() : null;

        $order = Order::where('number', strtoupper(trim($number)))->first();
        $owner = $order && $customer && $order->customer_id === $customer->id;
        $emailMatches = $order && filled($data['email'] ?? null) && mb_strtolower($order->email) === mb_strtolower(trim($data['email']));
        if (! $owner && ! $emailMatches) {
            return response()->json(['message' => 'We couldn\'t find an order with that number and email.'], 404);
        }

        if ($problem = $payments->payProblem($order)) {
            throw ValidationException::withMessages(['order' => $problem]);
        }
        $payment = $payments->startCheckout($order);

        return (new OrderResource($order->refresh()->load(['items', 'history', ...Order::DOCUMENTS])))->withPayment($payment);
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
            ->with(['items', 'history', 'returns.items', ...Order::DOCUMENTS])
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
