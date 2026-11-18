<?php

namespace App\Services;

use App\Mail\OrderPlacedMail;
use App\Models\Admin;
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
    public function __construct(private Pricing $pricing, private AddressBook $addressBook, private Audit $audit,
        private OrderDocuments $documents, private GiftCards $giftCards, private RewardPoints $rewardPoints) {}

    /**
     * Prices an order without placing it (no locks, no stock change): the
     * admin's "Create order" page shows these totals before placing it.
     */
    public function quote(array $data, ?Customer $customer): CartQuote
    {
        return $this->pricing->quote($data['items'], $data['coupon_code'] ?? null, $data['shipping_method'] ?? null,
            customerId: $customer?->id, email: $customer ? null : ($data['email'] ?? null),
            country: $data['shipping_address']['country'] ?? null, group: $customer?->priceGroup(),
            giftCardCode: $data['gift_card_code'] ?? null); // phase 10 (part B)
    }

    /**
     * $data: the validated PlaceOrderRequest fields (addresses already cleaned).
     * Throws a 422 (problems / coupon) or 409 (prices changed) response.
     *
     * Phase 6: $admin places the order for a customer or guest (source
     * "admin"; $data['note'] becomes a staff-only history note); $notify
     * false skips the confirmation email. $data['save_address'] adds the
     * shipping address to a signed-in customer's address book.
     */
    public function place(array $data, ?Customer $customer, ?Admin $admin = null, bool $notify = true): Order
    {
        $order = DB::transaction(function () use ($data, $customer, $admin) {
            $quote = $this->pricing->quote($data['items'], $data['coupon_code'] ?? null, $data['shipping_method'] ?? null,
                lock: true, customerId: $customer?->id, email: $data['email'], country: $data['shipping_address']['country'] ?? null,
                group: $customer?->priceGroup(), giftCardCode: $data['gift_card_code'] ?? null,
                // Phase 11: reward points (storefront checkout only; the customer row is locked).
                rewardsCustomer: $admin ? null : $customer, rewardPoints: $admin ? null : ($data['reward_points'] ?? null));

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
            // Phase 10 (part B): table rates may leave a method (or every method) out for this cart.
            if ($quote->shippingRequired && $quote->shippingError) {
                throw ValidationException::withMessages(['shipping_method' => $quote->shippingError]);
            }
            if (! $quote->requestedShippingAvailable) {
                throw ValidationException::withMessages(['shipping_method' => 'This shipping method isn\'t available for your order. Please choose another one.']);
            }
            // Phase 10 (part B): a gift card that covers everything is the payment; one that doesn't needs another method.
            if ($quote->giftCardError) {
                throw ValidationException::withMessages(['gift_card_code' => $quote->giftCardError]);
            }
            // Phase 11: reward points pay first; points and/or a gift card covering everything are the payment.
            if ($quote->rewardPointsError) {
                throw ValidationException::withMessages(['reward_points' => $quote->rewardPointsError]);
            }
            $paidByCard = $quote->giftCard && $quote->giftCardCents > 0;
            if (($paidByCard || $quote->rewardPointsCents > 0) && $quote->amountDueCents() === 0 && $quote->itemCount > 0) {
                $data['payment_method'] = $paidByCard ? 'gift_card' : 'reward_points';
            } elseif ($data['payment_method'] === 'gift_card') {
                throw ValidationException::withMessages(['payment_method' => $quote->giftCard
                    ? 'Your gift card doesn\'t cover the whole total. Choose how to pay the rest.'
                    : 'Enter your gift card code, or choose another payment method.']);
            } elseif ($data['payment_method'] === 'reward_points') {
                throw ValidationException::withMessages(['payment_method' => 'Your reward points don\'t cover the whole total. Choose how to pay the rest.']);
            }
            // The shopper saw a total; never charge a different one without asking.
            if (isset($data['expected_total']) && Pricing::toCents($data['expected_total']) !== $quote->totalCents) {
                throw new HttpResponseException(response()->json([
                    'message' => 'Prices changed since you added these items. Please review your order.',
                    'data' => $quote->toArray(),
                ], 409));
            }

            return $this->create($data, $customer, $quote, $admin);
        });

        // The address book is a convenience: it never stops an order (full book, or already saved: skipped).
        if ($customer && ! empty($data['save_address'])) {
            try {
                $this->addressBook->remember($customer, $order->shipping_address, $order->phone);
            } catch (Throwable $e) {
                report($e);
            }
        }

        // After the commit: a failed email must not undo a placed order.
        if ($notify) {
            try {
                Mail::to($order->email)->send(new OrderPlacedMail($order));
            } catch (Throwable $e) {
                report($e);
            }
        }

        return $order;
    }

    private function create(array $data, ?Customer $customer, CartQuote $quote, ?Admin $admin): Order
    {
        // Cash on delivery (and cash) can be prepared now; card/PayPal/bank transfer wait for the payment.
        $status = in_array($data['payment_method'], Order::PAY_LATER_METHODS, true) ? 'processing' : 'pending_payment';

        $order = Order::create([
            'customer_id' => $customer?->id,
            'customer_group' => $quote->group?->name,
            'source' => $admin ? 'admin' : 'storefront',
            'created_by_admin_id' => $admin?->id,
            'email' => $data['email'],
            'phone' => $data['phone'],
            'status' => $status,
            'payment_status' => 'unpaid',
            'payment_method' => $data['payment_method'],
            'shipping_method' => $quote->shippingMethod['id'],
            'shipping_label' => $quote->shippingMethod['label'],
            'shipping_eta' => $quote->shippingMethod['eta'],
            'coupon_code' => $quote->coupon['code'] ?? null,
            'applied_rules' => $quote->appliedRulesSummary(),
            'subtotal' => Pricing::format($quote->subtotalCents),
            'discount_total' => Pricing::format($quote->discountCents),
            'shipping_total' => Pricing::format($quote->shippingCents),
            'tax_total' => Pricing::format($quote->taxCents),
            'grand_total' => Pricing::format($quote->totalCents),
            // Phase 10 (part B): the gift card's part of the payment (taken below).
            'gift_card_id' => $quote->giftCard?->id,
            'gift_card_amount' => Pricing::format($quote->giftCardCents),
            // Phase 11: the reward points' part of the payment (taken below).
            'reward_points_spent' => $quote->rewardPoints,
            'reward_points_amount' => Pricing::format($quote->rewardPointsCents),
            'shipping_address' => $data['shipping_address'],
            'billing_address' => $data['billing_address'] ?? $data['shipping_address'],
            'placed_at' => now(),
        ]);
        // The number comes from the id, which exists only after the insert.
        $order->forceFill(['number' => Order::numberFor($order->id)])->save();

        foreach ($quote->lines as $line) {
            $product = $line['product'];
            $variant = $line['variant'];
            // decrement() is one UPDATE ... SET stock = stock - n; the row is locked, so it can't go negative.
            // A variant line takes the variant's stock (also locked); the product's stock is their sum.
            if ($line['type'] === 'gift_card') {
                // Phase 10 (part B): gift cards have no stock; the cards are made when the order is paid.
            } elseif ($variant) {
                $variant->decrement('stock_quantity', $line['quantity']);
                $product->syncVariantStock();
            } else {
                $product->decrement('stock_quantity', $line['quantity']);
            }

            $order->items()->create([
                'product_id' => $product->id,
                'variant_id' => $variant?->id,
                'sku' => $line['sku'],
                'name' => $product->name,
                'variant_label' => $line['variant_label'],
                'thumbnail_url' => $product->thumbnail_url,
                'unit_price' => Pricing::format($line['price_cents']),
                'discount_percent' => $product->discount_percent,
                'group_discount_percent' => $line['group_discount_percent'],
                'sale_price' => Pricing::format($line['sale_cents']),
                'quantity' => $line['quantity'],
                'line_total' => Pricing::format($line['line_cents']),
                'discount_amount' => Pricing::format($line['discount_cents'] ?? 0),
                'price_label' => $line['price_label'],
                'gift_card' => $line['gift_card'], // phase 10 (part B): amount and recipient of a gift card line
            ]);
        }

        // Count each rule's use (the code and an automatic rule). Their rows were locked by quote(), so the
        // usage limits checked there still hold: no other checkout can get in between.
        foreach ($quote->appliedRules as $rule) {
            Coupon::whereKey($rule['coupon']->id)->increment('times_used');
            CouponRedemption::create([
                'coupon_id' => $rule['coupon']->id,
                'order_id' => $order->id,
                'customer_id' => $customer?->id,
                'email' => $data['email'],
                'discount' => Pricing::format($rule['discount_cents']),
            ]);
        }

        // The confirmation email tells the customer, so this note is theirs to see.
        $order->history()->create([
            'status' => $status,
            'payment_status' => 'unpaid',
            'note' => 'Order placed.',
            'admin_id' => $admin?->id,
            'customer_notified' => true,
        ]);

        // Phase 10 (part B): the gift card's balance (locked by quote()) is taken now; when it pays
        // everything the order is paid at once (invoice), with no other payment.
        // Phase 11: reward points first (the customer row was locked by quote()).
        if ($customer && $quote->rewardPoints > 0) {
            $this->rewardPoints->spend($customer, $quote->rewardPoints, $order);
        }
        if ($quote->giftCard && $quote->giftCardCents > 0) {
            $this->giftCards->redeem($quote->giftCard, $quote->giftCardCents, $order);
        }
        if (in_array($data['payment_method'], ['gift_card', 'reward_points'], true)) {
            $points = $quote->rewardPoints > 0 ? 'reward points ('.number_format($quote->rewardPoints).' pts)' : null;
            $note = match (true) {
                $data['payment_method'] === 'gift_card' && $points !== null => "Paid with gift card ••••{$quote->giftCard->last4} and {$points}.",
                $data['payment_method'] === 'gift_card' => "Paid with gift card ••••{$quote->giftCard->last4}.",
                default => "Paid with {$points}.",
            };
            $order->forceFill(['payment_provider' => $data['payment_method'], 'paid_at' => now()])->save();
            $this->documents->invoice($order, null, $note, false);
        }
        if ($admin) {
            if (filled($data['note'] ?? null)) {
                // A staff note about the phone order: internal, never shown to the customer.
                $order->history()->create([
                    'status' => $status,
                    'payment_status' => 'unpaid',
                    'note' => trim($data['note']),
                    'admin_id' => $admin->id,
                    'customer_notified' => false,
                ]);
            }
            $this->audit->record('order.created', "Order {$order->number} created in the admin for {$order->email} (\${$order->grand_total}).",
                'order', $order->id, ['before' => [], 'after' => [
                    'number' => $order->number, 'email' => $order->email, 'customer_id' => $order->customer_id,
                    'payment_method' => $order->payment_method, 'grand_total' => $order->grand_total, 'source' => 'admin',
                ]], $admin);
        }

        return $order->load(['items', 'history']);
    }
}
