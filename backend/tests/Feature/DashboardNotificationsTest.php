<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AdminNotification;
use App\Models\Customer;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderReturn;
use App\Models\Review;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 7: dashboard blocks per permission, admin notifications, grid preferences. */
class DashboardNotificationsTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
    }

    public function test_the_dashboard_shows_only_the_blocks_the_role_allows(): void
    {
        $mug = $this->product(['price' => '10.00']);
        $this->placeOrder([['product_id' => $mug->id, 'quantity' => 2]])->assertCreated();
        Review::factory()->pending()->create(['product_id' => $mug->id]);

        $owner = $this->asAdmin($this->adminHeaders(), 'GET', '/api/admin/v1/overview')->assertOk()->json('data');
        $this->assertSame(['products', 'low_stock_products', 'orders', 'latest_orders', 'revenue_chart', 'customers', 'new_customers',
            'bestsellers', 'top_search_terms'], $owner['blocks']);
        $this->assertCount(30, $owner['revenue_chart']);
        $this->assertSame(['date' => now()->toDateString(), 'orders' => 1, 'revenue' => '24.99'], $owner['revenue_chart'][29]);
        $this->assertSame([['product_id' => $mug->id, 'name' => $mug->name, 'sku' => $mug->sku, 'units' => 2, 'revenue' => '20.00']], $owner['bestsellers']);
        $this->assertSame(['orders_to_invoice' => 1, 'orders_to_ship' => 1, 'return_requests' => 0, 'pending_reviews' => 1, 'low_stock_products' => 0], $owner['todo']);

        $sales = $this->asAdmin($this->signInAdmin(Admin::factory()->role(['dashboard.view', 'orders.view'])->create()), 'GET', '/api/admin/v1/overview')
            ->assertOk()->json('data');
        $this->assertSame(['orders', 'latest_orders', 'revenue_chart'], $sales['blocks']);
        $this->assertArrayNotHasKey('products', $sales);
        $this->assertArrayNotHasKey('customers', $sales);
        $this->assertSame(['orders_to_invoice' => 1, 'orders_to_ship' => 1], $sales['todo']);

        $bare = $this->asAdmin($this->signInAdmin(Admin::factory()->role(['dashboard.view'])->create()), 'GET', '/api/admin/v1/overview')
            ->assertOk()->json('data');
        $this->assertSame([], $bare['blocks']);
        $this->assertSame([], $bare['todo']);
    }

    public function test_low_stock_creates_one_notification_until_read(): void
    {
        $mug = $this->product(['name' => 'Mug', 'stock_quantity' => 11]);
        $headers = $this->adminHeaders();

        $this->placeOrder([['product_id' => $mug->id, 'quantity' => 2]])->assertCreated(); // 11 → 9: below 10
        $this->assertSame(1, AdminNotification::where('type', 'low_stock')->count());
        $mug->update(['stock_quantity' => 12]);
        $mug->update(['stock_quantity' => 5]); // crosses again while unread: no duplicate
        $this->assertSame(1, AdminNotification::where('type', 'low_stock')->count());

        $list = $this->asAdmin($headers, 'GET', '/api/admin/v1/notifications?unread=1')->assertOk()
            ->assertJsonPath('meta.unread_count', 1)->assertJsonPath('data.0.title', 'Low stock: Mug')
            ->assertJsonPath('data.0.severity', 'warning')->assertJsonPath('data.0.link', "/products/{$mug->id}")
            ->assertJsonPath('data.0.read_at', null);
        $this->asAdmin($headers, 'POST', '/api/admin/v1/notifications/'.$list->json('data.0.id').'/read')->assertOk()
            ->assertJsonPath('data.read_at', fn ($at) => $at !== null);
        $this->asAdmin($headers, 'GET', '/api/admin/v1/notifications?unread=1')->assertJsonCount(0, 'data')->assertJsonPath('meta.unread_count', 0);

        $mug->update(['stock_quantity' => 0]);
        $this->assertSame('critical', AdminNotification::where('type', 'out_of_stock')->sole()->severity);
        $mug->update(['stock_quantity' => 20]);
        $mug->update(['stock_quantity' => 3]); // read before: a new one may come
        $this->assertSame(2, AdminNotification::where('type', 'low_stock')->count());
    }

    public function test_notifications_are_filtered_by_permission(): void
    {
        $product = $this->product(['name' => 'Lamp']);
        Review::factory()->pending()->create(['product_id' => $product->id, 'author_name' => 'Bo', 'rating' => 4]);
        $product->update(['stock_quantity' => 0]);

        $catalog = $this->signInAdmin(Admin::factory()->role(['products.view'])->create());
        $this->asAdmin($catalog, 'GET', '/api/admin/v1/notifications')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.type', 'out_of_stock');
        $reviews = $this->signInAdmin(Admin::factory()->role(['reviews.view'])->create());
        $this->asAdmin($reviews, 'GET', '/api/admin/v1/notifications')->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.body', 'Bo rated Lamp 4/5.');

        $hidden = AdminNotification::where('type', 'out_of_stock')->sole();
        $this->asAdmin($reviews, 'POST', "/api/admin/v1/notifications/{$hidden->id}/read")->assertNotFound();
        $this->asAdmin($reviews, 'POST', '/api/admin/v1/notifications/read-all')->assertOk()
            ->assertJsonPath('data.marked', 1)->assertJsonPath('meta.unread_count', 0);
        // Reads are per admin: the catalog admin still has theirs unread.
        $this->asAdmin($catalog, 'GET', '/api/admin/v1/notifications?unread=1')->assertJsonPath('meta.unread_count', 1);
    }

    public function test_a_customer_return_request_notifies_return_staff(): void
    {
        $customer = Customer::factory()->create();
        $mug = $this->product();
        $number = $this->placeOrder([['product_id' => $mug->id, 'quantity' => 1]], ['email' => $customer->email])->json('data.number');
        $admin = $this->adminHeaders();
        $this->asAdmin($admin, 'POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'ups', 'notify_customer' => false])->assertCreated();
        $item = OrderItem::sole();
        $this->asAdmin($admin, 'POST', "/api/admin/v1/orders/{$number}/returns", ['items' => [['order_item_id' => $item->id, 'quantity' => 1]], 'reason' => 'Damaged'])
            ->assertCreated();
        $this->assertSame(0, AdminNotification::where('type', 'return_requested')->count()); // staff-created: no bell

        $this->app['auth']->forgetGuards();
        OrderReturn::query()->delete();
        $order = Order::sole();
        $order->forceFill(['customer_id' => $customer->id])->save();
        $headers = ['Authorization' => 'Bearer '.$this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])->json('data.tokens.access_token')];
        $this->postJson("/api/v1/orders/{$number}/returns", ['items' => [['order_item_id' => $item->id, 'quantity' => 1]], 'reason' => 'Damaged'], $headers)
            ->assertCreated();
        $notification = AdminNotification::where('type', 'return_requested')->sole();
        $this->assertSame(['returns.view', 'info'], [$notification->permission, $notification->severity]);
        $this->assertStringStartsWith('/returns/RMA-', $notification->link);
    }

    public function test_grid_preferences_are_per_admin(): void
    {
        $first = $this->adminHeaders();
        $second = $this->adminHeaders();
        $value = ['columns' => ['sku', 'name', 'price'], 'page_size' => 50, 'filters' => [['name' => 'Low stock', 'params' => ['stock' => 'low']]]];

        $this->asAdmin($first, 'GET', '/api/admin/v1/preferences/products_grid')->assertOk()->assertJsonPath('data.value', null);
        // JSON objects have no key order (MySQL sorts them), so compare with assertEquals.
        $this->assertEquals($value, $this->asAdmin($first, 'PUT', '/api/admin/v1/preferences/products_grid', ['value' => $value])->assertOk()->json('data.value'));
        $this->assertEquals($value, $this->asAdmin($first, 'GET', '/api/admin/v1/preferences/products_grid')->json('data.value'));
        $this->asAdmin($second, 'GET', '/api/admin/v1/preferences/products_grid')->assertJsonPath('data.value', null);

        $this->asAdmin($first, 'PUT', '/api/admin/v1/preferences/products_grid', ['value' => ['page_size' => 7]])->assertJsonValidationErrors('value.page_size');
        $this->asAdmin($first, 'PUT', '/api/admin/v1/preferences/products_grid', ['value' => ['theme' => 'dark']])->assertJsonValidationErrors('value');
        $this->asAdmin($first, 'GET', '/api/admin/v1/preferences/secrets')->assertNotFound();
    }
}
