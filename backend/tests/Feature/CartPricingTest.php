<?php

namespace Tests\Feature;

use App\Models\Coupon;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/**
 * The expected numbers come from the storefront's own calculateCartTotals()
 * (frontend/src/utils/cartTotals.js), so cart and checkout never disagree.
 */
class CartPricingTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private Product $mascara;   // 9.99, 10.48% off → 8.94

    private Product $lamp;      // 25.00

    private Product $chair;     // 74.99

    private Product $kettle;    // 33.33, 12.5% off → 29.16

    protected function setUp(): void
    {
        parent::setUp();
        $this->mascara = $this->product(['price' => '9.99', 'discount_percent' => '10.48']);
        $this->lamp = $this->product(['price' => '25.00']);
        $this->chair = $this->product(['price' => '74.99']);
        $this->kettle = $this->product(['price' => '33.33', 'discount_percent' => '12.50']);
    }

    private function validateCart(array $lines, ?string $coupon = null, string $shipping = 'standard'): TestResponse
    {
        $items = array_map(fn ($line) => ['product_id' => $line[0]->id ?? $line[0], 'quantity' => $line[1]], $lines);

        return $this->postJson('/api/v1/cart/validate', ['items' => $items, 'coupon_code' => $coupon, 'shipping_method' => $shipping])->assertOk();
    }

    private function assertTotals(TestResponse $response, int $count, string $subtotal, string $discount, string $shipping, string $total): void
    {
        $this->assertSame(
            ['item_count' => $count, 'subtotal' => $subtotal, 'discount' => $discount, 'group_discount' => '0.00', 'shipping' => $shipping, 'tax' => '0.00', 'total' => $total,
                'gift_card' => '0.00', 'reward_points' => '0.00', 'amount_due' => $total, 'cod_fee' => '0.00'], // phase 10 (part B); phase 11: reward_points; phase 14: cod_fee
            $response->json('data.totals'),
        );
    }

    public function test_the_contract_example(): void
    {
        $response = $this->validateCart([[$this->mascara, 2]], 'NEST10');

        $this->assertTotals($response, 2, '17.88', '1.79', '4.99', '21.08');
        $response->assertJsonPath('data.lines.0.price', '9.99')
            ->assertJsonPath('data.lines.0.discount_percent', 10.48)
            ->assertJsonPath('data.lines.0.sale_price', '8.94')
            ->assertJsonPath('data.lines.0.line_total', '17.88')
            ->assertJsonPath('data.lines.0.available', true)
            ->assertJsonPath('data.coupon', ['code' => 'NEST10', 'description' => '10% off your order'])
            ->assertJsonPath('data.coupon_error', null)
            ->assertJsonPath('data.problems', []);
        $this->assertSame([
            // Phase 10 (part B): source "flat" (no table rates). Phase 14: zone_code and eta days (table zone rates only).
            ['id' => 'standard', 'label' => 'Standard', 'eta' => '3–5 business days', 'price' => '4.99', 'source' => 'flat', 'zone_code' => null, 'eta_days_min' => null, 'eta_days_max' => null],
            ['id' => 'express', 'label' => 'Express', 'eta' => '1–2 business days', 'price' => '12.99', 'source' => 'flat', 'zone_code' => null, 'eta_days_min' => null, 'eta_days_max' => null],
            ['id' => 'nextDay', 'label' => 'Next day', 'eta' => 'Next business day (order by 2 pm)', 'price' => '24.99', 'source' => 'flat', 'zone_code' => null, 'eta_days_min' => null, 'eta_days_max' => null],
        ], $response->json('data.shipping_options'));
    }

    public function test_standard_shipping_is_free_from_50_after_the_coupon(): void
    {
        $free = $this->validateCart([[$this->lamp, 2]]);
        $this->assertTotals($free, 2, '50.00', '0.00', '0.00', '50.00');
        $this->assertSame('0.00', $free->json('data.shipping_options.0.price'));

        // NEST10 (any case) takes it to 45.00: below the threshold again.
        $this->assertTotals($this->validateCart([[$this->lamp, 2]], 'nest10'), 2, '50.00', '5.00', '4.99', '49.99');
    }

    public function test_save20_needs_150_of_merchandise(): void
    {
        $short = $this->validateCart([[$this->chair, 2]], 'SAVE20');
        $this->assertTotals($short, 2, '149.98', '0.00', '0.00', '149.98');
        $short->assertJsonPath('data.coupon', null)->assertJsonPath('data.coupon_error', 'Spend $0.02 more to use this code.');

        $cent = $this->product(['price' => '0.02']);
        $ok = $this->validateCart([[$this->chair, 2], [$cent, 1]], 'save20');
        $this->assertTotals($ok, 3, '150.00', '20.00', '0.00', '130.00');
        $ok->assertJsonPath('data.coupon.code', 'SAVE20');
    }

    public function test_a_fixed_coupon_never_exceeds_the_subtotal(): void
    {
        Coupon::where('code', 'SAVE20')->update(['min_subtotal' => null]); // coupons live in the database since phase 3

        $this->assertTotals($this->validateCart([[$this->mascara, 1]], 'SAVE20'), 1, '8.94', '8.94', '4.99', '4.99');
    }

    public function test_express_and_next_day_are_flat_rates(): void
    {
        $this->assertTotals($this->validateCart([[$this->lamp, 4]], null, 'express'), 4, '100.00', '0.00', '12.99', '112.99');
        $this->assertTotals($this->validateCart([[$this->kettle, 3]], 'NEST10', 'nextDay'), 3, '87.48', '8.75', '24.99', '103.72');
    }

    public function test_an_unknown_coupon_is_reported_and_ignored(): void
    {
        $response = $this->validateCart([[$this->kettle, 3]], 'BOGUS');

        $this->assertTotals($response, 3, '87.48', '0.00', '0.00', '87.48');
        $response->assertJsonPath('data.coupon', null)->assertJsonPath('data.coupon_error', 'This code is not valid.');
    }

    public function test_unavailable_products_are_listed_with_a_problem_but_not_charged(): void
    {
        $draft = $this->product(['status' => 'draft']);
        $deleted = $this->product();
        $deleted->delete();

        $response = $this->validateCart([[$this->lamp, 1], [$draft, 1], [$deleted, 2], [99999, 1]]);

        $this->assertTotals($response, 1, '25.00', '0.00', '4.99', '29.99');
        $this->assertSame([true, false, false, false], array_column($response->json('data.lines'), 'available'));
        $this->assertSame(
            [[$draft->id, 'unavailable'], [$deleted->id, 'unavailable'], [99999, 'unavailable']],
            array_map(fn ($p) => [$p['product_id'], $p['code']], $response->json('data.problems')),
        );
        $response->assertJsonPath('data.lines.3.name', null)->assertJsonPath('data.lines.3.line_total', '0.00');
    }

    public function test_stock_and_minimum_order_problems(): void
    {
        $scarce = $this->product(['stock_quantity' => 2]);
        $bulk = $this->product(['min_order_quantity' => 5]);

        $response = $this->validateCart([[$scarce, 3], [$bulk, 2]]);

        $this->assertSame(['insufficient_stock', 'below_minimum'], array_column($response->json('data.problems'), 'code'));
        $response->assertJsonPath('data.lines.0.stock_quantity', 2)->assertJsonPath('data.lines.1.min_order_quantity', 5);
    }

    public function test_an_empty_cart_costs_nothing(): void
    {
        $this->assertTotals($this->validateCart([]), 0, '0.00', '0.00', '0.00', '0.00');
    }

    public function test_cart_validation(): void
    {
        $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => 1, 'quantity' => 1000]]])->assertJsonValidationErrors('items.0.quantity');
        $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => 1, 'quantity' => 0]]])->assertJsonValidationErrors('items.0.quantity');
        $this->postJson('/api/v1/cart/validate', ['items' => array_fill(0, 51, ['product_id' => 1, 'quantity' => 1])])->assertJsonValidationErrors('items');
        $this->postJson('/api/v1/cart/validate', ['items' => [], 'shipping_method' => 'drone'])->assertJsonValidationErrors('shipping_method');
    }
}
