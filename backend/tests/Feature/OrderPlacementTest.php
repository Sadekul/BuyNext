<?php

namespace Tests\Feature;

use App\Mail\OrderPlacedMail;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

class OrderPlacementTest extends TestCase
{
    use PlacesOrders, ReadsCodes, RefreshDatabase;

    private Product $mascara;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->mascara = $this->product(['price' => '9.99', 'discount_percent' => '10.48', 'stock_quantity' => 10]);
    }

    private function line(Product $product, int $quantity): array
    {
        return ['product_id' => $product->id, 'quantity' => $quantity];
    }

    private function customerToken(Customer $customer): string
    {
        return $this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])->json('data.tokens.access_token');
    }

    public function test_a_guest_places_an_order(): void
    {
        $response = $this->placeOrder([$this->line($this->mascara, 2)], ['coupon_code' => 'NEST10', 'expected_total' => '21.08', 'email' => 'Guest@Example.com'])
            ->assertCreated();

        $order = Order::sole();
        $this->assertSame('BN-'.(100000 + $order->id), $order->number);
        $this->assertNull($order->customer_id);
        $response->assertJsonPath('data.number', $order->number)
            ->assertJsonPath('data.status', 'processing')            // cash on delivery: prepared right away
            ->assertJsonPath('data.payment_status', 'unpaid')
            ->assertJsonPath('data.email', 'guest@example.com')
            ->assertJsonPath('data.shipping_method', ['id' => 'standard', 'label' => 'Standard', 'eta' => '3–5 business days'])
            ->assertJsonPath('data.coupon_code', 'NEST10')
            ->assertJsonPath('data.totals', ['item_count' => 2, 'subtotal' => '17.88', 'discount' => '1.79', 'shipping' => '4.99', 'tax' => '0.00', 'total' => '21.08',
                'gift_card' => '0.00', 'amount_due' => '21.08', 'paid' => '0.00', 'refunded' => '0.00'])
            ->assertJsonPath('data.items.0', [
                'product_id' => $this->mascara->id, 'variant_id' => null, 'sku' => $this->mascara->sku, 'name' => $this->mascara->name, 'variant_label' => null,
                'thumbnail_url' => $this->mascara->thumbnail_url,
                'price' => '9.99', 'discount_percent' => 10.48, 'group_discount_percent' => 0, 'sale_price' => '8.94', 'quantity' => 2, 'line_total' => '17.88',
                'discount' => '1.79', 'price_label' => null, // phase 7: the line's share of the coupon, the catalog rule label
                'gift_card' => null, // phase 10 (part B)
            ])
            ->assertJsonPath('data.history.0.status', 'processing')
            ->assertJsonPath('data.history.0.note', 'Order placed.');
        // No billing address given: it is the shipping address.
        $this->assertSame($response->json('data.shipping_address'), $response->json('data.billing_address'));
        $this->assertArrayNotHasKey('admin_id', $response->json('data.history.0'));

        $this->assertSame(8, $this->mascara->fresh()->stock_quantity);
        Mail::assertSent(OrderPlacedMail::class, fn ($mail) => $mail->hasTo('guest@example.com') && $mail->order->is($order));
    }

    public function test_card_and_paypal_orders_wait_for_payment(): void
    {
        $this->placeOrder([$this->line($this->mascara, 1)], ['payment_method' => 'card'])->assertCreated()
            ->assertJsonPath('data.status', 'pending_payment')->assertJsonPath('data.payment_status', 'unpaid');
    }

    public function test_an_order_is_a_snapshot(): void
    {
        $originalName = $this->mascara->name;
        $number = $this->placeOrder([$this->line($this->mascara, 1)])->json('data.number');
        $this->mascara->update(['price' => '99.00', 'name' => 'Renamed']);

        $this->postJson('/api/v1/orders/lookup', ['number' => $number, 'email' => 'guest@example.com'])->assertOk()
            ->assertJsonPath('data.items.0.price', '9.99')->assertJsonPath('data.items.0.name', $originalName);
    }

    public function test_a_customer_order_belongs_to_them_and_only_they_can_read_it(): void
    {
        $ava = Customer::factory()->create(['email' => 'ava@example.com', 'phone' => '+15550100111']);
        $ben = Customer::factory()->create(['email' => 'ben@example.com']);
        $avaToken = $this->customerToken($ava);

        $number = $this->placeOrder([$this->line($this->mascara, 1)], ['email' => null, 'phone' => null], $this->bearer($avaToken))
            ->assertCreated()->assertJsonPath('data.email', 'ava@example.com')->assertJsonPath('data.phone', '+15550100111')
            ->json('data.number');
        $this->assertSame($ava->id, Order::sole()->customer_id);

        $this->getJson('/api/v1/orders', $this->bearer($avaToken))->assertOk()
            ->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.number', $number)->assertJsonMissingPath('data.0.history');
        $this->getJson("/api/v1/orders/{$number}", $this->bearer($avaToken))->assertOk()->assertJsonPath('data.history.0.status', 'processing');

        $this->app['auth']->forgetGuards();
        $benToken = $this->customerToken($ben);
        $this->getJson("/api/v1/orders/{$number}", $this->bearer($benToken))->assertNotFound()->assertJsonPath('message', 'Order not found.');
        $this->getJson('/api/v1/orders', $this->bearer($benToken))->assertJsonPath('meta.total', 0);

        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/orders')->assertUnauthorized();
    }

    public function test_an_admin_or_invalid_token_is_never_treated_as_a_customer(): void
    {
        $this->placeOrder([$this->line($this->mascara, 1)], [], $this->adminHeaders())->assertForbidden();
        $this->app['auth']->forgetGuards();
        $this->placeOrder([$this->line($this->mascara, 1)], [], $this->bearer('1|not-a-real-token'))->assertUnauthorized();

        $this->assertSame(0, Order::count());
        $this->assertSame(10, $this->mascara->fresh()->stock_quantity);
    }

    public function test_insufficient_stock_is_refused_and_nothing_changes(): void
    {
        $this->placeOrder([$this->line($this->mascara, 11)])->assertUnprocessable()
            ->assertJsonValidationErrors('items')
            ->assertJsonPath('problems.0.code', 'insufficient_stock')
            ->assertJsonPath('problems.0.product_id', $this->mascara->id);

        $this->assertSame(0, Order::count());
        $this->assertSame(10, $this->mascara->fresh()->stock_quantity);
        Mail::assertNothingSent();
    }

    public function test_unavailable_and_below_minimum_products_are_refused(): void
    {
        $draft = $this->product(['status' => 'draft']);
        $bulk = $this->product(['min_order_quantity' => 3]);

        $this->placeOrder([$this->line($draft, 1)])->assertUnprocessable()->assertJsonPath('problems.0.code', 'unavailable');
        $this->placeOrder([$this->line($bulk, 2)])->assertUnprocessable()->assertJsonPath('problems.0.code', 'below_minimum');
        $this->assertSame(0, Order::count());
    }

    public function test_a_changed_total_answers_409_with_the_new_prices(): void
    {
        $this->placeOrder([$this->line($this->mascara, 2)], ['expected_total' => '19.99'])
            ->assertStatus(409)
            ->assertJsonPath('message', 'Prices changed since you added these items. Please review your order.')
            ->assertJsonPath('data.totals.total', '22.87')
            ->assertJsonPath('data.lines.0.sale_price', '8.94');

        $this->assertSame(0, Order::count());
        $this->assertSame(10, $this->mascara->fresh()->stock_quantity);
    }

    public function test_coupon_and_field_validation(): void
    {
        $this->placeOrder([$this->line($this->mascara, 1)], ['coupon_code' => 'BOGUS'])->assertJsonValidationErrors(['coupon_code' => 'This code is not valid.']);

        $body = $this->checkoutBody([$this->line($this->mascara, 1)]);
        $body['shipping_address']['postal_code'] = '!!';
        $body['shipping_address']['country'] = 'France';
        unset($body['payment_method']);
        $this->postJson('/api/v1/orders', $body)->assertUnprocessable()
            ->assertJsonValidationErrors(['shipping_address.postal_code' => 'The postal code is invalid.', 'shipping_address.country', 'payment_method']);

        $this->placeOrder([], ['email' => 'not-an-email'])->assertJsonValidationErrors(['items' => 'Your cart is empty.', 'email']);
        $this->placeOrder([$this->line($this->mascara, 1)], ['billing_address' => ['first_name' => 'Ava']])->assertJsonValidationErrors('billing_address.line1');
        $this->assertSame(0, Order::count());
    }

    public function test_guests_look_up_an_order_with_its_number_and_email(): void
    {
        $number = $this->placeOrder([$this->line($this->mascara, 1)])->json('data.number');
        $notFound = ['message' => 'We couldn\'t find an order with that number and email.'];

        $this->postJson('/api/v1/orders/lookup', ['number' => strtolower($number), 'email' => 'GUEST@example.com'])->assertOk()->assertJsonPath('data.number', $number);
        $this->postJson('/api/v1/orders/lookup', ['number' => $number, 'email' => 'someone@example.com'])->assertNotFound()->assertExactJson($notFound);
        $this->postJson('/api/v1/orders/lookup', ['number' => 'BN-999999', 'email' => 'guest@example.com'])->assertNotFound()->assertExactJson($notFound);
    }

    public function test_placing_orders_is_rate_limited(): void
    {
        config(['buynest.orders_per_minute' => 2]);

        $this->placeOrder([$this->line($this->mascara, 1)])->assertCreated();
        $this->placeOrder([$this->line($this->mascara, 1)])->assertCreated();
        $this->placeOrder([$this->line($this->mascara, 1)])->assertTooManyRequests();
    }
}
