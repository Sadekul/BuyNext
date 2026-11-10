<?php

namespace App\Services;

use App\Mail\OrderPlacedMail;
use App\Models\Coupon;
use App\Models\CouponRedemption;
use App\Models\Customer;
use App\Models\Order;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Places an order, all in one database transaction:
 * lock the products (and the coupon) → price again → check stock → take
 * the stock → write the order, its items, the coupon use, and its first
 * history entry.
 * If anything fails, the transaction rolls back and nothing is kept.
 */
class Checkout
{
    public function __construct(private Pricing $pricing) {}

    /**
     * $data: the validated PlaceOrderRequest fields (addresses already cleaned).
     * Throws a 422 (problems / coupon) or 409 (prices changed) response.
     */
    public function place(array $data, ?Customer $customer): Order
    {
        $order = DB::transaction(function () use ($data, $customer) {
            $quote = $this->pricing->quote($data['items'], $data['coupon_code'] ?? null, $data['shipping_method'],
                lock: true, customerId: $customer?->id, email: $data['email'], country: $data['shipping_address']['country'] ?? null);

            if ($quote->hasProblems()) {
                throw new HttpResponseException(response()->json([
                    'message' => 'Some items in your cart can\'t be ordered.',
                    'errors' => ['items' => array_column($quote->problems, 'message')],
                    'problems' => $quote->problems,
                ], 422));
            }
            if ($quote->couponError) {
                throw ValidationException::withMessages(['coupon_code' => $quote->couponError]);
            }
            // The shopper saw a total; never charge a different one without asking.
            if (isset($data['expected_total']) && Pricing::toCents($data['expected_total']) !== $quote->totalCents) {
                throw new HttpResponseException(response()->json([
                    'message' => 'Prices changed since you added these items. Please review your order.',
                    'data' => $quote->toArray(),
                ], 409));
            }

            return $this->create($data, $customer, $quote);
        });

        // After the commit: a failed email must not undo a placed order.
        try {
            Mail::to($order->email)->send(new OrderPlacedMail($order));
        } catch (Throwable $e) {
            report($e);
        }

        return $order;
    }

    private function create(array $data, ?Customer $customer, CartQuote $quote): Order
    {
        // Cash on delivery can be prepared now; card/PayPal wait for the payment.
        $status = $data['payment_method'] === 'cod' ? 'processing' : 'pending_payment';

        $order = Order::create([
            'customer_id' => $customer?->id,
            'email' => $data['email'],
            'phone' => $data['phone'],
            'status' => $status,
            'payment_status' => 'unpaid',
            'payment_method' => $data['payment_method'],
            'shipping_method' => $quote->shippingMethod['id'],
            'shipping_label' => $quote->shippingMethod['label'],
            'shipping_eta' => $quote->shippingMethod['eta'],
            'coupon_code' => $quote->coupon['code'] ?? null,
            'subtotal' => Pricing::format($quote->subtotalCents),
            'discount_total' => Pricing::format($quote->discountCents),
            'shipping_total' => Pricing::format($quote->shippingCents),
            'tax_total' => Pricing::format($quote->taxCents),
            'grand_total' => Pricing::format($quote->totalCents),
            'shipping_address' => $data['shipping_address'],
            'billing_address' => $data['billing_address'] ?? $data['shipping_address'],
            'placed_at' => now(),
        ]);
        // The number comes from the id, which exists only after the insert.
        $order->forceFill(['number' => Order::numberFor($order->id)])->save();

        foreach ($quote->lines as $line) {
            $product = $line['product'];
            // decrement() is one UPDATE ... SET stock = stock - n; the row is locked, so it can't go negative.
            $product->decrement('stock_quantity', $line['quantity']);

            $order->items()->create([
                'product_id' => $product->id,
                'sku' => $product->sku,
                'name' => $product->name,
                'thumbnail_url' => $product->thumbnail_url,
                'unit_price' => Pricing::format($line['price_cents']),
                'discount_percent' => $product->discount_percent,
                'sale_price' => Pricing::format($line['sale_cents']),
                'quantity' => $line['quantity'],
                'line_total' => Pricing::format($line['line_cents']),
            ]);
        }

        // Count the coupon use. Its row was locked by quote(), so the usage
        // limits checked there still hold: no other checkout can get in between.
        if ($quote->couponId) {
            Coupon::whereKey($quote->couponId)->increment('times_used');
            CouponRedemption::create([
                'coupon_id' => $quote->couponId,
                'order_id' => $order->id,
                'customer_id' => $customer?->id,
                'email' => $data['email'],
            ]);
        }

        // The confirmation email tells the customer, so this note is theirs to see.
        $order->history()->create([
            'status' => $status,
            'payment_status' => 'unpaid',
            'note' => 'Order placed.',
            'customer_notified' => true,
        ]);

        return $order->load(['items', 'history']);
    }
}
