<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\Order;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 6: customer groups and their discount in the cart and at checkout. */
class CustomerGroupTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
    }

    private function group(string $code): CustomerGroup
    {
        return CustomerGroup::where('code', $code)->sole();
    }

    private function customerHeaders(Customer $customer): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])
            ->assertOk()->json('data.tokens.access_token')];
    }

    public function test_the_seeded_groups_and_new_customers_join_general(): void
    {
        $list = $this->asAdmin($this->admin, 'GET', '/api/admin/v1/customer-groups')->assertOk();
        $this->assertSame(['General', 'VIP', 'Wholesale'], array_column($list->json('data'), 'name'));
        $list->assertJsonPath('data.0', [
            'id' => $this->group('general')->id, 'name' => 'General', 'code' => 'general', 'discount_percent' => '0.00', 'is_system' => true,
            'is_default' => true, 'customers_count' => 0,
            'created_at' => $this->group('general')->created_at->toIso8601ZuluString(), 'updated_at' => $this->group('general')->updated_at->toIso8601ZuluString(),
        ]);
        $this->assertSame('10.00', $this->group('wholesale')->discount_percent);
        $this->assertSame('5.00', $this->group('vip')->discount_percent);

        $customer = Customer::factory()->create();
        $this->assertSame($this->group('general')->id, $customer->group_id);
        $this->asAdmin($this->customerHeaders($customer), 'GET', '/api/v1/me')->assertOk()
            ->assertJsonPath('data.group', ['name' => 'General', 'discount_percent' => '0.00']);
    }

    public function test_staff_create_edit_and_delete_groups_with_guards(): void
    {
        $created = $this->asAdmin($this->admin, 'POST', '/api/admin/v1/customer-groups', ['name' => 'Trade Partners', 'discount_percent' => 12.5])
            ->assertCreated()->assertJsonPath('data.code', 'trade_partners')->assertJsonPath('data.discount_percent', '12.50');
        $id = $created->json('data.id');

        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/customer-groups', ['name' => 'trade partners', 'code' => 'Bad Code!', 'discount_percent' => 91])
            ->assertUnprocessable()->assertJsonValidationErrors(['name', 'code', 'discount_percent']);
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/customer-groups/{$id}", ['discount_percent' => '15'])
            ->assertOk()->assertJsonPath('data.discount_percent', '15.00');

        // General: the discount can change, the code can't, it can't be deleted.
        $general = $this->group('general');
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/customer-groups/{$general->id}", ['discount_percent' => 2])->assertOk();
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/customer-groups/{$general->id}", ['code' => 'everyone'])
            ->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/customer-groups/{$general->id}")->assertUnprocessable()->assertJsonValidationErrors('group');

        // A group in use: refused with the count.
        Customer::factory()->count(2)->create(['group_id' => $id]);
        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/customer-groups/{$id}")->assertUnprocessable()
            ->assertJsonPath('errors.group.0', '2 customers are in the Trade Partners group. Move them all to another group first.');
        Customer::where('group_id', $id)->update(['group_id' => $general->id]);
        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/customer-groups/{$id}")->assertNoContent();

        foreach (['customer_group.created', 'customer_group.updated', 'customer_group.deleted'] as $action) {
            $this->assertDatabaseHas('audit_log', ['action' => $action]);
        }
    }

    public function test_group_changes_need_customer_groups_manage(): void
    {
        $viewer = $this->signInAdmin(Admin::factory()->role(['customers.view'])->create());
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/customer-groups')->assertOk();
        $this->asAdmin($viewer, 'POST', '/api/admin/v1/customer-groups', ['name' => 'X', 'discount_percent' => 1])
            ->assertForbidden()->assertJsonPath('permission', 'customer_groups.manage');
    }

    public function test_the_group_discount_prices_the_cart_after_the_product_discount_and_before_coupons(): void
    {
        // 9.99 with 10.48% off = 8.94; Wholesale 10% off = 8.046 → 8.05. Two units = 16.10; NEST10 = 1.61.
        $mascara = $this->product(['price' => '9.99', 'discount_percent' => '10.48', 'stock_quantity' => 10]);
        $customer = Customer::factory()->create(['group_id' => $this->group('wholesale')->id]);
        $headers = $this->customerHeaders($customer);

        $cart = $this->asAdmin($headers, 'POST', '/api/v1/cart/validate', [
            'items' => [['product_id' => $mascara->id, 'quantity' => 2]], 'coupon_code' => 'NEST10', 'shipping_method' => 'standard',
        ])->assertOk();
        $cart->assertJsonPath('data.lines.0.base_sale_price', '8.94')
            ->assertJsonPath('data.lines.0.sale_price', '8.05')
            ->assertJsonPath('data.lines.0.group_discount_percent', 10)
            ->assertJsonPath('data.lines.0.line_total', '16.10')
            ->assertJsonPath('data.customer_group', ['name' => 'Wholesale', 'discount_percent' => '10.00'])
            ->assertJsonPath('data.totals', ['item_count' => 2, 'subtotal' => '16.10', 'discount' => '1.61', 'group_discount' => '1.78',
                'shipping' => '4.99', 'tax' => '0.00', 'total' => '19.48', 'gift_card' => '0.00', 'reward_points' => '0.00', 'amount_due' => '19.48']); // phase 10 (part B) and 11: the last three

        // Checkout charges the same and stores the group.
        $order = $this->placeOrder([['product_id' => $mascara->id, 'quantity' => 2]], ['coupon_code' => 'NEST10', 'expected_total' => '19.48'], $headers)
            ->assertCreated()
            ->assertJsonPath('data.customer_group', 'Wholesale')
            ->assertJsonPath('data.items.0.sale_price', '8.05')
            ->assertJsonPath('data.items.0.group_discount_percent', 10)
            ->assertJsonPath('data.totals.total', '19.48');
        $this->assertSame('10.00', Order::sole()->items->sole()->group_discount_percent);

        // Guests are priced as General (0% unless staff change it).
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $mascara->id, 'quantity' => 1]]])
            ->assertJsonPath('data.lines.0.sale_price', '8.94')->assertJsonPath('data.customer_group.name', 'General');
        $this->group('general')->update(['discount_percent' => 5]);
        $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $mascara->id, 'quantity' => 1]]])
            ->assertJsonPath('data.lines.0.sale_price', '8.49'); // 8.94 × 0.95 = 8.493
    }

    public function test_a_refund_of_a_group_priced_order_gives_back_what_was_paid(): void
    {
        $product = $this->product(['price' => '20.00', 'stock_quantity' => 5]);
        $customer = Customer::factory()->create(['group_id' => $this->group('vip')->id]);
        $number = $this->placeOrder([['product_id' => $product->id, 'quantity' => 2]], [], $this->customerHeaders($customer))
            ->assertCreated()->assertJsonPath('data.totals.subtotal', '38.00')->json('data.number');

        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();
        $this->asAdmin($this->admin, 'GET', "/api/admin/v1/orders/{$number}/refundable")->assertOk()
            ->assertJsonPath('data.items.0.unit_refund', '19.00');
    }
}
