<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Coupon;
use App\Models\CouponRedemption;
use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\Order;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/**
 * Phase 7: cart price rules (coupons with conditions, automatic rules).
 * Shoes > Sneakers; sneaker 30.00 (Sneakers), sock 4.00 (Shoes), hat 10.00 (Hats).
 */
class CartPriceRuleTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    private Category $shoes;

    private Product $sneaker;

    private Product $sock;

    private Product $hat;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
        $this->shoes = Category::factory()->create(['name' => 'Shoes']);
        $sneakers = Category::factory()->create(['name' => 'Sneakers', 'parent_id' => $this->shoes->id]);
        $this->sneaker = $this->product(['name' => 'Sneaker', 'price' => '30.00', 'category_id' => $sneakers->id]);
        $this->sock = $this->product(['name' => 'Sock', 'price' => '4.00', 'category_id' => $this->shoes->id]);
        $this->hat = $this->product(['name' => 'Hat', 'price' => '10.00', 'category_id' => Category::factory()->create(['name' => 'Hats'])->id]);
    }

    private function rule(array $attributes): Coupon
    {
        return Coupon::create(['description' => 'Rule', 'type' => 'percent', 'value' => '10.00', 'is_active' => true, ...$attributes])->refresh();
    }

    /** $items: [[product, quantity], ...] */
    private function cart(array $items, ?string $code = null, array $extra = [], array $headers = []): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->postJson('/api/v1/cart/validate', [
            'items' => array_map(fn ($item) => ['product_id' => $item[0]->id, 'quantity' => $item[1]], $items),
            'coupon_code' => $code, 'shipping_method' => 'standard', ...$extra,
        ], $headers)->assertOk();
    }

    private function lineDiscounts(TestResponse $response): array
    {
        return array_column($response->json('data.lines'), 'discount', 'name');
    }

    private function customerHeaders(Customer $customer): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])
            ->assertOk()->json('data.tokens.access_token')];
    }

    public function test_the_discount_goes_to_eligible_lines_only_and_refunds_follow_it(): void
    {
        $this->rule(['code' => 'SHOE20', 'description' => '20% off shoes', 'value' => '20.00', 'applies_to' => 'categories', 'category_ids' => [$this->shoes->id]]);

        $this->assertSame('This code applies to Shoes only.', $this->cart([[$this->hat, 1]], 'shoe20')->json('data.coupon_error'));

        $cart = $this->cart([[$this->sneaker, 1], [$this->hat, 2]], 'shoe20');
        $cart->assertJsonPath('data.coupon_error', null)->assertJsonPath('data.totals.discount', '6.00')
            ->assertJsonPath('data.totals.total', '48.99')
            ->assertJsonPath('data.applied_rules', [[
                'id' => Coupon::where('code', 'SHOE20')->value('id'), 'code' => 'SHOE20', 'label' => '20% off shoes', 'automatic' => false,
                'discount' => '6.00', 'free_shipping' => false,
            ]]);
        $this->assertSame(['Sneaker' => '6.00', 'Hat' => '0.00'], $this->lineDiscounts($cart));

        // Order, invoice, refund: a hat gives back its full 10.00 (none of the discount leaks onto it).
        $number = $this->placeOrder([['product_id' => $this->sneaker->id, 'quantity' => 1], ['product_id' => $this->hat->id, 'quantity' => 2]],
            ['coupon_code' => 'SHOE20', 'expected_total' => '48.99'])->assertCreated()
            ->assertJsonPath('data.items.0.discount', '6.00')->assertJsonPath('data.items.1.discount', '0.00')
            ->assertJsonPath('data.applied_rules.0.code', 'SHOE20')->json('data.number');
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();
        $refundable = collect($this->asAdmin($this->admin, 'GET', "/api/admin/v1/orders/{$number}/refundable")->assertOk()->json('data.items'))
            ->keyBy('name');
        $this->assertSame(['24.00', '10.00'], [$refundable['Sneaker']['unit_refund'], $refundable['Hat']['unit_refund']]);
        $items = Order::sole()->items->keyBy('name');
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$number}/credit-memos", [
            'items' => [['order_item_id' => $items['Hat']->id, 'quantity' => 2], ['order_item_id' => $items['Sneaker']->id, 'quantity' => 1]],
            'shipping_refund' => '4.99',
        ])->assertCreated()->assertJsonPath('data.total', '48.99');
    }

    public function test_a_fixed_discount_is_shared_over_eligible_lines_to_the_cent(): void
    {
        $this->rule(['code' => 'SHOE7', 'type' => 'fixed', 'value' => '7.00', 'applies_to' => 'products', 'product_ids' => [$this->sneaker->id, $this->sock->id]]);
        $cart = $this->cart([[$this->sneaker, 1], [$this->sock, 1], [$this->hat, 1]], 'SHOE7');
        $discounts = $this->lineDiscounts($cart);
        $this->assertSame('0.00', $discounts['Hat']);
        $this->assertSame('7.00', number_format((float) $discounts['Sneaker'] + (float) $discounts['Sock'], 2));
        $this->assertSame(['Sneaker' => '6.18', 'Sock' => '0.82', 'Hat' => '0.00'], $discounts);

        $this->assertSame('This code applies to Hat and Sneaker only.', Coupon::create([
            'code' => 'TWO', 'description' => 'x', 'type' => 'fixed', 'value' => '1.00', 'applies_to' => 'products',
            'product_ids' => [$this->hat->id, $this->sneaker->id],
        ])->refresh()->problemFor(0, hasEligibleLines: false));
    }

    public function test_buy_x_get_y_frees_the_cheapest_eligible_units(): void
    {
        $this->rule(['code' => 'B2G1', 'type' => 'buy_x_get_y', 'value' => '0.00', 'buy_quantity' => 2, 'get_quantity' => 1,
            'applies_to' => 'categories', 'category_ids' => [$this->shoes->id]]);

        // 2 eligible units (the hats don't count): nothing free yet.
        $this->cart([[$this->sneaker, 2], [$this->hat, 3]], 'B2G1')->assertJsonPath('data.totals.discount', '0.00');
        // 3 units: the sock is free.
        $cart = $this->cart([[$this->sneaker, 2], [$this->sock, 1], [$this->hat, 3]], 'B2G1');
        $cart->assertJsonPath('data.totals.discount', '4.00');
        $this->assertSame(['Sneaker' => '0.00', 'Sock' => '4.00', 'Hat' => '0.00'], $this->lineDiscounts($cart));
        // 6 units: two free, the sock and one sneaker.
        $cart = $this->cart([[$this->sneaker, 5], [$this->sock, 1]], 'B2G1');
        $cart->assertJsonPath('data.totals.discount', '34.00');
        $this->assertSame(['Sneaker' => '30.00', 'Sock' => '4.00'], $this->lineDiscounts($cart));
    }

    public function test_free_shipping_and_the_minimum_subtotal_message(): void
    {
        $this->rule(['code' => 'SHIPIT', 'value' => '5.00', 'free_shipping' => true, 'min_subtotal' => '20.00']);

        $this->assertSame('Spend $10.00 more to use this code.', $this->cart([[$this->hat, 1]], 'SHIPIT')->json('data.coupon_error'));
        $cart = $this->cart([[$this->hat, 2]], 'SHIPIT', ['shipping_method' => 'express']);
        $cart->assertJsonPath('data.coupon_error', null)->assertJsonPath('data.totals.discount', '1.00')
            ->assertJsonPath('data.totals.shipping', '0.00')->assertJsonPath('data.applied_rules.0.free_shipping', true);
        $this->assertSame(['0.00', '0.00', '0.00'], array_column($cart->json('data.shipping_options'), 'price'));
    }

    public function test_customer_groups(): void
    {
        $vip = CustomerGroup::where('code', 'vip')->sole();
        $this->rule(['code' => 'VIPONLY', 'customer_group_ids' => [$vip->id]]);

        $this->assertSame('This code isn\'t available for your account.', $this->cart([[$this->hat, 1]], 'VIPONLY')->json('data.coupon_error'));
        $general = Customer::factory()->create();
        $this->assertSame('This code isn\'t available for your account.',
            $this->cart([[$this->hat, 1]], 'VIPONLY', [], $this->customerHeaders($general))->json('data.coupon_error'));
        $member = Customer::factory()->create(['group_id' => $vip->id]);
        $this->cart([[$this->hat, 1]], 'VIPONLY', [], $this->customerHeaders($member))->assertJsonPath('data.coupon_error', null)
            ->assertJsonPath('data.coupon.code', 'VIPONLY');
    }

    public function test_the_best_automatic_rule_applies_by_itself_and_combines_with_one_code(): void
    {
        $tenPercent = $this->rule(['description' => '10% off everything', 'auto_apply' => true]);
        $threeOff = $this->rule(['description' => '$3 off', 'type' => 'fixed', 'value' => '3.00', 'auto_apply' => true]);
        $this->rule(['description' => 'Never', 'auto_apply' => true, 'is_active' => false, 'value' => '90.00']);

        // 20.00 of hats: $3 off beats 10% (2.00).
        $this->cart([[$this->hat, 2]])->assertJsonPath('data.applied_rules', [[
            'id' => $threeOff->id, 'code' => null, 'label' => '$3 off', 'automatic' => true, 'discount' => '3.00', 'free_shipping' => false,
        ]])->assertJsonPath('data.coupon', null)->assertJsonPath('data.coupon_error', null)->assertJsonPath('data.totals.discount', '3.00');

        // 50.00: 10% (5.00) wins; NEST10 then takes 10% of what is left (45.00 → 4.50).
        $cart = $this->cart([[$this->sneaker, 1], [$this->hat, 2]], 'nest10');
        $this->assertSame([[$tenPercent->id, null, true, '5.00'], [Coupon::where('code', 'NEST10')->value('id'), 'NEST10', false, '4.50']],
            array_map(fn ($rule) => [$rule['id'], $rule['code'], $rule['automatic'], $rule['discount']], $cart->json('data.applied_rules')));
        $cart->assertJsonPath('data.coupon.code', 'NEST10')->assertJsonPath('data.totals.discount', '9.50');

        // A bad code is reported; the automatic rule still applies.
        $this->cart([[$this->hat, 2]], 'NOPE')->assertJsonPath('data.coupon_error', 'This code is not valid.')
            ->assertJsonPath('data.totals.discount', '3.00');

        // Checkout counts both uses and saves the rules; cancelling gives both back.
        $number = $this->placeOrder([['product_id' => $this->sneaker->id, 'quantity' => 1], ['product_id' => $this->hat->id, 'quantity' => 2]],
            ['coupon_code' => 'NEST10'])->assertCreated()
            ->assertJsonPath('data.coupon_code', 'NEST10')->assertJsonPath('data.totals.discount', '9.50')
            ->assertJsonPath('data.applied_rules.0.label', '10% off everything')->assertJsonPath('data.applied_rules.1.code', 'NEST10')
            ->json('data.number');
        $this->assertSame([1, 1], [$tenPercent->fresh()->times_used, Coupon::where('code', 'NEST10')->value('times_used')]);
        $this->assertSame(['5.00', '4.50'], CouponRedemption::orderBy('id')->pluck('discount')->all());

        // The coupon report lists the automatic rule by name.
        $today = now()->toDateString();
        $report = $this->asAdmin($this->admin, 'GET', "/api/admin/v1/reports/coupons?from={$today}&to={$today}")->assertOk()->json('data');
        $this->assertEqualsCanonicalizing([
            ['coupon_id' => $tenPercent->id, 'code' => null, 'name' => '10% off everything', 'automatic' => true, 'uses' => 1, 'discount_total' => '5.00'],
            ['coupon_id' => Coupon::where('code', 'NEST10')->value('id'), 'code' => 'NEST10', 'name' => '10% off your order', 'automatic' => false,
                'uses' => 1, 'discount_total' => '4.50'],
        ], $report);

        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'cancelled'])->assertOk();
        $this->assertSame([0, 0], [$tenPercent->fresh()->times_used, Coupon::where('code', 'NEST10')->value('times_used')]);
    }

    public function test_uses_per_customer_apply_to_automatic_rules_too(): void
    {
        $rule = $this->rule(['description' => 'Welcome', 'type' => 'fixed', 'value' => '2.00', 'auto_apply' => true, 'usage_limit_per_customer' => 1]);
        $customer = Customer::factory()->create();
        $headers = $this->customerHeaders($customer);

        $this->cart([[$this->hat, 1]], null, [], $headers)->assertJsonPath('data.totals.discount', '2.00');
        $this->app['auth']->forgetGuards();
        $this->placeOrder([['product_id' => $this->hat->id, 'quantity' => 1]], ['email' => $customer->email], $headers)->assertCreated()
            ->assertJsonPath('data.totals.discount', '2.00');
        $this->cart([[$this->hat, 1]], null, [], $this->customerHeaders($customer))->assertJsonPath('data.totals.discount', '0.00')
            ->assertJsonPath('data.applied_rules', []);
        // Another shopper still gets it.
        $this->cart([[$this->hat, 1]], null, ['email' => 'someone@example.com'])->assertJsonPath('data.totals.discount', '2.00');
        $this->assertSame(1, $rule->fresh()->times_used);
    }

    public function test_staff_create_rules_with_the_new_fields(): void
    {
        $vip = CustomerGroup::where('code', 'vip')->sole();
        $auto = $this->asAdmin($this->admin, 'POST', '/api/admin/v1/coupons', [
            'auto_apply' => true, 'type' => 'buy_x_get_y', 'buy_quantity' => 2, 'get_quantity' => 1,
            'applies_to' => 'categories', 'category_ids' => [$this->shoes->id], 'customer_group_ids' => [$vip->id],
        ])->assertCreated()
            ->assertJsonPath('data.code', null)->assertJsonPath('data.auto_apply', true)->assertJsonPath('data.description', 'Buy 2, get 1 free')
            ->assertJsonPath('data.category_ids', [$this->shoes->id])->assertJsonPath('data.customer_group_ids', [$vip->id])
            ->assertJsonPath('data.value', '0.00')->assertJsonPath('data.free_shipping', false)->assertJsonPath('data.product_ids', []);
        $this->assertSame('coupon.created', AuditLog::latest('id')->value('action'));

        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/coupons', ['auto_apply' => true, 'code' => 'HAS-CODE', 'type' => 'percent', 'value' => 5])
            ->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/coupons', ['type' => 'percent', 'value' => 5])
            ->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/coupons', ['code' => 'BXGY', 'type' => 'buy_x_get_y', 'applies_to' => 'products'])
            ->assertUnprocessable()->assertJsonValidationErrors(['buy_quantity', 'get_quantity', 'product_ids']);
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/coupons', ['code' => 'FREESHIP', 'type' => 'free_shipping'])
            ->assertCreated()->assertJsonPath('data.free_shipping', true);

        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/coupons?kind=automatic')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $auto->json('data.id'));
        $this->asAdmin($this->admin, 'PATCH', '/api/admin/v1/coupons/'.$auto->json('data.id'), ['free_shipping' => true])->assertOk()
            ->assertJsonPath('data.free_shipping', true);
    }
}
