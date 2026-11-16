<?php

namespace Tests\Feature;

use App\Mail\OrderPlacedMail;
use App\Models\Admin;
use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\Order;
use App\Models\Product;
use App\Models\ProductVariant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 6: orders staff create in the admin (phone orders), through the storefront's checkout service. */
class AdminOrderCreateTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    private Product $lamp;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
        $this->lamp = $this->product(['price' => '25.00', 'discount_percent' => '0', 'stock_quantity' => 5]);
    }

    private function body(array $overrides = []): array
    {
        return array_merge([
            'guest' => ['email' => 'Phone@Example.com', 'phone' => '+1 555 010 0177', 'first_name' => 'Phone', 'last_name' => 'Buyer'],
            'items' => [['product_id' => $this->lamp->id, 'quantity' => 2]],
            'shipping_address' => $this->checkoutBody([])['shipping_address'],
            'same_as_shipping' => true,
            'shipping_method' => 'express',
            'payment_method' => 'bank_transfer',
            'coupon_code' => 'NEST10',
        ], $overrides);
    }

    public function test_the_quote_equals_the_created_order_and_stock_is_taken_only_on_create(): void
    {
        $quote = $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders/quote', $this->body())->assertOk();
        // 50.00 − NEST10 5.00 + express 12.99
        $quote->assertJsonPath('data.totals.total', '57.99')
            ->assertJsonPath('data.problems', [])
            ->assertJsonPath('data.payment_methods', ['card', 'paypal', 'cod', 'bank_transfer', 'cash']);
        $this->assertSame(5, $this->lamp->fresh()->stock_quantity);
        $this->assertSame(0, Order::count());

        $created = $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders', [...$this->body(), 'expected_total' => '57.99', 'note' => 'Called at 10am.'])
            ->assertCreated();
        $created->assertJsonPath('data.source', 'admin')
            ->assertJsonPath('data.created_by_admin.name', 'Store Admin')
            ->assertJsonPath('data.email', 'phone@example.com')
            ->assertJsonPath('data.phone', '+15550100177')
            ->assertJsonPath('data.status', 'pending_payment') // bank transfer waits for the money
            ->assertJsonPath('data.payment_method', 'bank_transfer')
            // The same totals as the quote (orders have paid/refunded instead of the cart's group_discount).
            ->assertJsonPath('data.totals', [...array_diff_key($quote->json('data.totals'), ['group_discount' => 0]), 'paid' => '0.00', 'refunded' => '0.00'])
            ->assertJsonPath('data.billing_address', $created->json('data.shipping_address'))
            ->assertJsonPath('data.history.0.note', 'Order placed.')
            ->assertJsonPath('data.history.1.note', 'Called at 10am.')
            ->assertJsonPath('data.history.1.customer_notified', false);
        $this->assertSame(3, $this->lamp->fresh()->stock_quantity);
        Mail::assertSent(OrderPlacedMail::class, fn ($mail) => $mail->hasTo('phone@example.com'));
        $this->assertDatabaseHas('audit_log', ['action' => 'order.created', 'subject_id' => Order::sole()->id]);

        // The customer never sees the staff note.
        $number = $created->json('data.number');
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/orders/lookup', ['number' => $number, 'email' => 'phone@example.com'])->assertOk()
            ->assertJsonPath('data.history.1.note', null);

        // The grid shows and filters the source.
        $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]])->assertCreated();
        $grid = $this->asAdmin($this->admin, 'GET', '/api/admin/v1/orders?source=admin')->assertOk();
        $this->assertSame([$number], array_column($grid->json('data'), 'number'));
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/orders?source=storefront')->assertJsonPath('data.0.source', 'storefront');
    }

    public function test_a_customers_order_uses_their_group_and_account_details(): void
    {
        $customer = Customer::factory()->create(['email' => 'trade@example.com', 'phone' => '+15550100155',
            'group_id' => CustomerGroup::where('code', 'wholesale')->sole()->id]);
        $body = $this->body(['guest' => null, 'customer_id' => $customer->id, 'coupon_code' => null, 'payment_method' => 'cash',
            'shipping_method' => 'standard', 'notify_customer' => false]);

        $quote = $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders/quote', $body)->assertOk()
            ->assertJsonPath('data.lines.0.sale_price', '22.50')
            ->assertJsonPath('data.customer_group.name', 'Wholesale')
            ->assertJsonPath('data.totals.total', '49.99'); // 45.00 + 4.99 (not over the 50.00 threshold)

        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders', $body)->assertCreated()
            ->assertJsonPath('data.customer.id', $customer->id)
            ->assertJsonPath('data.email', 'trade@example.com')
            ->assertJsonPath('data.phone', '+15550100155')
            ->assertJsonPath('data.customer_group', 'Wholesale')
            ->assertJsonPath('data.status', 'processing') // cash: like cash on delivery
            ->assertJsonPath('data.totals.total', $quote->json('data.totals.total'));
        Mail::assertNothingSent();

        // Cash may ship before the invoice, like cash on delivery.
        $number = Order::sole()->number;
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'ups'])->assertCreated();

        // The customer sees it in their account.
        $this->app['auth']->forgetGuards();
        $token = $this->postJson('/api/v1/auth/login', ['email' => 'trade@example.com', 'password' => 'Password123'])->json('data.tokens.access_token');
        $this->getJson('/api/v1/orders', ['Authorization' => "Bearer {$token}"])->assertJsonPath('data.0.number', $number);
    }

    public function test_admin_only_payment_methods_are_refused_on_the_storefront(): void
    {
        $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], ['payment_method' => 'bank_transfer'])
            ->assertUnprocessable()->assertJsonValidationErrors('payment_method');
        $this->app['auth']->forgetGuards();
        $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], ['payment_method' => 'cash'])
            ->assertUnprocessable()->assertJsonValidationErrors('payment_method');
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders', $this->body(['payment_method' => 'bitcoin']))
            ->assertUnprocessable()->assertJsonValidationErrors('payment_method');
        // A method switched off in the settings is off for staff too; bank transfer and cash stay.
        $this->asAdmin($this->admin, 'PATCH', '/api/admin/v1/settings', ['checkout' => ['enabled_payment_methods' => ['card']]])->assertOk();
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders', $this->body(['payment_method' => 'paypal']))
            ->assertUnprocessable()->assertJsonValidationErrors('payment_method');
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders', $this->body(['payment_method' => 'cash']))->assertCreated();
    }

    public function test_stock_and_validation_problems(): void
    {
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders/quote', $this->body(['items' => [['product_id' => $this->lamp->id, 'quantity' => 9]]]))
            ->assertOk()->assertJsonPath('data.problems.0.code', 'insufficient_stock');
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders', $this->body(['items' => [['product_id' => $this->lamp->id, 'quantity' => 9]]]))
            ->assertUnprocessable()->assertJsonPath('problems.0.code', 'insufficient_stock');
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders', $this->body(['expected_total' => '1.00']))->assertStatus(409);
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders', $this->body(['guest' => null]))
            ->assertUnprocessable()->assertJsonValidationErrors(['customer_id']);
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders', $this->body(['customer_id' => 1]))
            ->assertUnprocessable()->assertJsonValidationErrors('customer_id');
        $blocked = Customer::factory()->blocked()->create();
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders', $this->body(['guest' => null, 'customer_id' => $blocked->id]))
            ->assertUnprocessable()->assertJsonPath('errors.customer_id.0', 'This customer is blocked. Unblock the account to place an order for them.');
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders', $this->body(['same_as_shipping' => false, 'billing_address' => ['first_name' => 'X']]))
            ->assertUnprocessable()->assertJsonValidationErrors(['billing_address.line1', 'billing_address.country']);
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders', $this->body(['items' => []]))
            ->assertUnprocessable()->assertJsonValidationErrors('items');
        // Quote needs only the items (live totals while the form is filled in).
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders/quote', ['items' => [['product_id' => $this->lamp->id, 'quantity' => 1]]])
            ->assertOk()->assertJsonPath('data.totals.total', '29.99');
        $this->assertSame(0, Order::count());
        $this->assertSame(5, $this->lamp->fresh()->stock_quantity);
    }

    public function test_admin_orders_lock_rows_and_keep_variants(): void
    {
        $this->asAdmin($this->admin, 'PUT', "/api/admin/v1/products/{$this->lamp->id}/options", ['options' => [['name' => 'Size', 'values' => ['S']]]])->assertOk();
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/products/{$this->lamp->id}/variants/generate")->assertOk();
        $variant = ProductVariant::sole();
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$this->lamp->id}/variants/{$variant->id}", ['stock_quantity' => 2, 'is_active' => true])->assertOk();

        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders', $this->body())->assertUnprocessable()->assertJsonPath('problems.0.code', 'variant_required');

        $queries = [];
        DB::listen(function ($query) use (&$queries) {
            $queries[] = $query->sql;
        });
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders', $this->body(['items' => [['product_id' => $this->lamp->id, 'variant_id' => $variant->id, 'quantity' => 2]]]))
            ->assertCreated()->assertJsonPath('data.items.0.variant_label', 'Size: S');
        $this->assertNotEmpty(array_filter($queries, fn ($sql) => str_contains($sql, 'from `product_variants`') && str_contains($sql, 'for update')));
        $this->assertNotEmpty(array_filter($queries, fn ($sql) => str_contains($sql, 'from `products`') && str_contains($sql, 'for update')));
        $this->assertSame(0, $variant->fresh()->stock_quantity);
    }

    public function test_creating_orders_needs_orders_create(): void
    {
        $viewer = $this->signInAdmin(Admin::factory()->role('Viewer')->create());
        $this->asAdmin($viewer, 'POST', '/api/admin/v1/orders/quote', $this->body())->assertForbidden()->assertJsonPath('permission', 'orders.create');
        $this->asAdmin($viewer, 'POST', '/api/admin/v1/orders', $this->body())->assertForbidden()->assertJsonPath('permission', 'orders.create');
        $sales = $this->signInAdmin(Admin::factory()->role('Sales staff')->create());
        $this->asAdmin($sales, 'POST', '/api/admin/v1/orders', $this->body())->assertCreated();
    }
}
