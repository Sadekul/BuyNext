<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Customer;
use App\Models\Order;
use App\Services\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Store settings: admin GET/PATCH, the public /store, and checkout/cart following them (including tax). */
class SettingsTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->headers = $this->adminHeaders();
    }

    private function patchSettings(array $body)
    {
        return $this->asAdmin($this->headers, 'PATCH', '/api/admin/v1/settings', $body);
    }

    private function germanyTax(bool $included = false): void
    {
        $this->patchSettings(['tax' => ['tax_enabled' => true, 'prices_include_tax' => $included, 'tax_rates' => [['country' => 'Germany', 'rate' => 19]]]])->assertOk();
    }

    private function germanAddress(): array
    {
        return ['first_name' => 'Lena', 'last_name' => 'Kunde', 'line1' => 'Hauptstr. 1', 'line2' => null, 'city' => 'Berlin',
            'state' => null, 'postal_code' => '10115', 'country' => 'Germany'];
    }

    public function test_the_defaults_are_the_old_store_rules(): void
    {
        $this->asAdmin($this->headers, 'GET', '/api/admin/v1/settings')->assertOk()
            ->assertJsonPath('data.general.store_name', 'BuyNest')
            ->assertJsonPath('data.shipping', [
                'standard_price' => '4.99', 'free_shipping_threshold' => '50.00', 'express_price' => '12.99', 'next_day_price' => '24.99',
                'enabled_methods' => ['standard', 'express', 'nextDay'],
                'default_weight_grams' => 500, // phase 10 (part B)
            ])
            ->assertJsonPath('data.tax', ['tax_enabled' => false, 'tax_rates' => [], 'prices_include_tax' => false])
            ->assertJsonPath('data.checkout.allowed_countries', ['United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'Bangladesh', 'India'])
            ->assertJsonPath('data.checkout.guest_checkout', true)
            ->assertJsonPath('data.checkout.enabled_payment_methods', ['card', 'paypal', 'cod'])
            ->assertJsonPath('data.inventory.low_stock_threshold', 10)
            ->assertJsonPath('meta.payment_methods.2', ['id' => 'cod', 'label' => 'Cash on delivery']);
    }

    public function test_the_public_store_rules(): void
    {
        $this->getJson('/api/v1/store')->assertOk()->assertExactJson(['data' => [
            'store_name' => 'BuyNest',
            'support_email' => 'support@buynest.example.com',
            'support_phone' => '+1 (555) 010-2030',
            'shipping_methods' => [
                ['id' => 'standard', 'label' => 'Standard', 'eta' => '3–5 business days', 'price' => '4.99'],
                ['id' => 'express', 'label' => 'Express', 'eta' => '1–2 business days', 'price' => '12.99'],
                ['id' => 'nextDay', 'label' => 'Next day', 'eta' => 'Next business day (order by 2 pm)', 'price' => '24.99'],
            ],
            'free_shipping_threshold' => '50.00',
            'allowed_countries' => ['United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'Bangladesh', 'India'],
            'payment_methods' => ['card', 'paypal', 'cod'],
            'guest_checkout' => true,
            'tax_enabled' => false,
            'returns_enabled' => true,
            'return_window_days' => 30,
            'return_reasons' => ['Damaged', 'Wrong item', 'Not as described', 'No longer needed', 'Other'],
            'card_payments' => 'manual',
            'paypal_payments' => 'manual', // phase 10 (part B)
            'ga4_measurement_id' => null, // phase 10 (part A)
            // Phase 11.
            'rewards' => ['enabled' => false, 'earn_rate' => '1.00', 'point_value' => '0.0100', 'min_redeem' => 100],
            'currencies' => ['base' => 'USD', 'display' => []],
        ]]);
    }

    public function test_changes_are_validated_per_key(): void
    {
        $this->patchSettings(['shipping' => ['standard_price' => -1, 'enabled_methods' => [], 'colour' => 'red'], 'nope' => []])
            ->assertUnprocessable()->assertJsonValidationErrors(['shipping.colour', 'nope']);
        $this->patchSettings([
            'general' => ['store_name' => '', 'support_email' => 'not-an-email'],
            'shipping' => ['standard_price' => '4.999', 'enabled_methods' => [], 'express_price' => 'free'],
            'tax' => ['tax_enabled' => 'maybe', 'tax_rates' => [['country' => 'Germany', 'rate' => 101], ['country' => 'germany', 'rate' => 5]]],
            'checkout' => ['enabled_payment_methods' => ['bitcoin'], 'allowed_countries' => []],
            'inventory' => ['low_stock_threshold' => -5],
        ])->assertUnprocessable()->assertJsonValidationErrors([
            'general.store_name', 'general.support_email', 'shipping.standard_price', 'shipping.enabled_methods', 'shipping.express_price',
            'tax.tax_enabled', 'tax.tax_rates.0.rate', 'tax.tax_rates.1.country', 'checkout.enabled_payment_methods.0',
            'checkout.allowed_countries', 'inventory.low_stock_threshold',
        ]);
        $this->assertSame('4.99', app(Settings::class)->get('standard_price'));
    }

    public function test_a_patch_changes_only_what_was_sent_and_the_cart_follows_at_once(): void
    {
        $product = $this->product(['price' => '10.00']);
        $cart = fn () => $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $product->id, 'quantity' => 1]]])->assertOk();
        $this->assertSame('4.99', $cart()->json('data.totals.shipping'));

        $this->patchSettings(['shipping' => ['standard_price' => '6', 'free_shipping_threshold' => 8]])->assertOk()
            ->assertJsonPath('data.shipping.standard_price', '6.00')
            ->assertJsonPath('data.shipping.express_price', '12.99');

        $this->assertSame('0.00', $cart()->json('data.totals.shipping')); // 10.00 is over the new 8.00 threshold
        $this->patchSettings(['shipping' => ['free_shipping_threshold' => '100']])->assertOk();
        $this->assertSame('6.00', $cart()->json('data.totals.shipping'));
        $this->assertSame('16.00', $cart()->json('data.totals.total'));
    }

    public function test_disabled_shipping_and_payment_methods_are_refused(): void
    {
        $product = $this->product();
        $this->patchSettings(['shipping' => ['enabled_methods' => ['standard', 'express']], 'checkout' => ['enabled_payment_methods' => ['card']]])->assertOk();

        $this->assertSame(['standard', 'express'], array_column(
            $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $product->id, 'quantity' => 1]]])->json('data.shipping_options'), 'id'));
        $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $product->id, 'quantity' => 1]], 'shipping_method' => 'nextDay'])
            ->assertUnprocessable()->assertJsonValidationErrors('shipping_method');
        $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]], ['shipping_method' => 'nextDay', 'payment_method' => 'card'])
            ->assertUnprocessable()->assertJsonValidationErrors('shipping_method');
        $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]], ['payment_method' => 'cod'])
            ->assertUnprocessable()->assertJsonValidationErrors('payment_method');
        $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]], ['payment_method' => 'card'])->assertCreated();

        $this->getJson('/api/v1/store')->assertJsonPath('data.payment_methods', ['card']);
    }

    public function test_countries_follow_the_settings(): void
    {
        $product = $this->product();
        $this->patchSettings(['checkout' => ['allowed_countries' => ['Germany']]])->assertOk();

        $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]])
            ->assertUnprocessable()->assertJsonValidationErrors('shipping_address.country');
        $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]], ['shipping_address' => $this->germanAddress()])->assertCreated();
    }

    public function test_guest_checkout_can_be_switched_off(): void
    {
        $product = $this->product();
        $this->patchSettings(['checkout' => ['guest_checkout' => false]])->assertOk();

        $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]])
            ->assertForbidden()->assertExactJson(['message' => 'Please sign in to check out.', 'code' => 'guest_checkout_disabled']);

        $customer = Customer::factory()->create();
        $token = $this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])->json('data.tokens.access_token');
        $this->app['auth']->forgetGuards();
        $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]], [], ['Authorization' => "Bearer {$token}"])->assertCreated();
    }

    public function test_the_low_stock_threshold(): void
    {
        $product = $this->product(['stock_quantity' => 15]);
        $this->getJson("/api/v1/products/{$product->id}")->assertJsonPath('data.availability', 'in_stock');

        $this->patchSettings(['inventory' => ['low_stock_threshold' => 20]])->assertOk();
        $this->getJson("/api/v1/products/{$product->id}")->assertJsonPath('data.availability', 'low_stock');
        $this->asAdmin($this->headers, 'GET', '/api/admin/v1/overview')->assertJsonPath('data.low_stock_threshold', 20);
    }

    public function test_tax_by_shipping_country(): void
    {
        $product = $this->product(['price' => '20.00']);
        $cart = fn (array $extra = []) => $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $product->id, 'quantity' => 2]], ...$extra])->assertOk();

        // Tax off (the default): 0, and that is final.
        $cart(['country' => 'Germany'])->assertJsonPath('data.totals.tax', '0.00')->assertJsonPath('data.tax_estimated', true);

        $this->germanyTax();
        // No country yet: no tax, not estimated.
        $cart()->assertJsonPath('data.totals.tax', '0.00')->assertJsonPath('data.totals.total', '44.99')->assertJsonPath('data.tax_estimated', false);
        // 19% of (40.00 + 4.99 shipping) = 8.5481 → 8.55.
        $cart(['country' => 'Germany'])->assertJsonPath('data.totals.tax', '8.55')->assertJsonPath('data.totals.total', '53.54')
            ->assertJsonPath('data.tax_estimated', true);
        // No rate for the country: 0.
        $cart(['country' => 'Canada'])->assertJsonPath('data.totals.tax', '0.00')->assertJsonPath('data.tax_estimated', true);
        // After a coupon: 19% of (36.00 + 4.99) = 7.7881 → 7.79.
        $cart(['country' => 'Germany', 'coupon_code' => 'NEST10'])->assertJsonPath('data.totals.tax', '7.79')->assertJsonPath('data.totals.total', '48.78');

        $order = $this->placeOrder([['product_id' => $product->id, 'quantity' => 2]],
            ['shipping_address' => $this->germanAddress(), 'expected_total' => '53.54'])->assertCreated();
        $order->assertJsonPath('data.totals.tax', '8.55')->assertJsonPath('data.totals.total', '53.54');
        $this->assertSame('8.55', Order::sole()->tax_total);
    }

    public function test_prices_that_include_tax(): void
    {
        $product = $this->product(['price' => '20.00']);
        $this->germanyTax(included: true);

        // 44.99 already contains 19%: 44.99 × 19 / 119 = 7.1832 → 7.18, and the total stays 44.99.
        $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $product->id, 'quantity' => 2]], 'country' => 'Germany'])
            ->assertJsonPath('data.totals.tax', '7.18')->assertJsonPath('data.totals.total', '44.99');
    }

    public function test_refunds_with_tax_give_back_exactly_what_was_paid(): void
    {
        $product = $this->product(['price' => '20.00']);
        $this->germanyTax();
        $number = $this->placeOrder([['product_id' => $product->id, 'quantity' => 2]], ['shipping_address' => $this->germanAddress()])
            ->assertCreated()->json('data.number');
        $this->asAdmin($this->headers, 'POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();
        $item = Order::sole()->items[0];

        // Tax 8.55 shared over the line (40.00) and shipping (4.99): 7.60 and 0.95.
        $this->asAdmin($this->headers, 'GET', "/api/admin/v1/orders/{$number}/refundable")->assertOk()
            ->assertJsonPath('data.items.0.unit_refund', '23.80')
            ->assertJsonPath('data.shipping_refundable', '5.94')
            ->assertJsonPath('data.max_total', '53.54');

        $refund = fn (int $qty, string $shipping) => $this->asAdmin($this->headers, 'POST', "/api/admin/v1/orders/{$number}/credit-memos", [
            'items' => [['order_item_id' => $item->id, 'quantity' => $qty]], 'shipping_refund' => $shipping,
        ]);
        $refund(1, '0.00')->assertCreated()->assertJsonPath('data.total', '23.80');
        $refund(1, '5.94')->assertCreated()->assertJsonPath('data.total', '29.74');

        $this->asAdmin($this->headers, 'GET', "/api/admin/v1/orders/{$number}")
            ->assertJsonPath('data.payment_status', 'refunded')
            ->assertJsonPath('data.totals.refunded', '53.54');
    }

    public function test_settings_permissions(): void
    {
        $viewer = $this->signInAdmin(Admin::factory()->role('Viewer')->create());
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/settings')->assertOk();
        $this->asAdmin($viewer, 'PATCH', '/api/admin/v1/settings', ['general' => ['store_name' => 'Mine']])
            ->assertForbidden()->assertJsonPath('permission', 'settings.edit');
    }
}
