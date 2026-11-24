<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Coupon;
use App\Models\Order;
use App\Models\Product;
use App\Models\ShippingRate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/**
 * Phase 10 (part B): shipping table rates. Flat prices (phase 4) stay for
 * methods without rows: standard 4.99 (free from 50.00), express 12.99,
 * next day 24.99.
 */
class ShippingRateTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    private Product $book;   // 10.00, 400 g

    private Product $anvil;  // 30.00, 20 kg

    private Product $mystery; // 5.00, no weight (counts as the default, 500 g)

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = $this->adminHeaders();
        $this->book = $this->product(['price' => '10.00', 'weight' => 400]);
        $this->anvil = $this->product(['price' => '30.00', 'weight' => 20000]);
        $this->mystery = $this->product(['price' => '5.00', 'weight' => null]);
    }

    private function rate(array $attributes): ShippingRate
    {
        return ShippingRate::create(['country' => '*', 'min_weight_grams' => 0, 'min_subtotal' => '0.00', 'position' => 0, ...$attributes]);
    }

    private function cart(array $lines, ?string $country = 'United States', ?string $method = null): TestResponse
    {
        return $this->postJson('/api/v1/cart/validate', [
            'items' => array_map(fn ($line) => ['product_id' => $line[0]->id, 'quantity' => $line[1]], $lines),
            'shipping_method' => $method,
            'country' => $country,
        ])->assertOk();
    }

    private function shippingPrices(TestResponse $response): array
    {
        return collect($response->json('data.shipping_options'))->mapWithKeys(fn ($o) => [$o['id'] => [$o['price'], $o['source']]])->all();
    }

    private function admin(string $method, string $uri, array $body = []): TestResponse
    {
        return $this->asAdmin($this->admin, $method, $uri, $body);
    }

    public function test_methods_without_rows_keep_their_flat_price(): void
    {
        $response = $this->cart([[$this->book, 1]]);
        $this->assertSame(['standard' => ['4.99', 'flat'], 'express' => ['12.99', 'flat'], 'nextDay' => ['24.99', 'flat']], $this->shippingPrices($response));
        $response->assertJsonPath('data.shipping_method', 'standard')
            ->assertJsonPath('data.shipping_required', true)
            ->assertJsonPath('data.shipping_error', null)
            ->assertJsonPath('data.weight_grams', 400)
            ->assertJsonPath('data.totals.shipping', '4.99');
    }

    public function test_the_first_matching_row_prices_the_method_by_weight_country_and_subtotal(): void
    {
        $this->rate(['method' => 'standard', 'max_weight_grams' => 1000, 'price' => '3.00', 'position' => 0]);
        $this->rate(['method' => 'standard', 'min_weight_grams' => 1000, 'max_weight_grams' => 10000, 'price' => '8.00', 'position' => 1]);
        $this->rate(['method' => 'standard', 'min_weight_grams' => 10000, 'price' => '25.00', 'position' => 2]);
        $this->rate(['method' => 'standard', 'country' => 'Germany', 'price' => '6.50', 'position' => 9]); // exact country wins over "*"
        $this->rate(['method' => 'express', 'max_weight_grams' => 5000, 'max_subtotal' => '40.00', 'price' => '9.00']);

        // 400 g: the first row. Express (subtotal 10 < 40, 400 g) too; next day keeps its flat price.
        $this->assertSame(['standard' => ['3.00', 'table'], 'express' => ['9.00', 'table'], 'nextDay' => ['24.99', 'flat']],
            $this->shippingPrices($this->cart([[$this->book, 1]])));
        // 3 × 400 g = 1200 g: the second row (min inclusive, max exclusive).
        $this->assertSame('8.00', $this->cart([[$this->book, 3]])->json('data.shipping_options.0.price'));
        // Products without a weight count as the default (500 g): 2 × 500 = 1000 g → the second row.
        $this->cart([[$this->mystery, 2]])->assertJsonPath('data.weight_grams', 1000)->assertJsonPath('data.shipping_options.0.price', '8.00');
        // The setting changes the default.
        $this->admin('PATCH', '/api/admin/v1/settings', ['shipping' => ['default_weight_grams' => 100]])->assertOk();
        $this->cart([[$this->mystery, 2]])->assertJsonPath('data.weight_grams', 200)->assertJsonPath('data.shipping_options.0.price', '3.00');
        // 20 kg: the third row, and express isn't offered (no row matches).
        $heavy = $this->cart([[$this->anvil, 1]], method: 'express');
        $this->assertSame(['standard' => ['25.00', 'table'], 'nextDay' => ['24.99', 'flat']], $this->shippingPrices($heavy));
        $heavy->assertJsonPath('data.shipping_method', 'standard')->assertJsonPath('data.totals.shipping', '25.00');
        // Germany: its own row, whatever the weight.
        $this->assertSame('6.50', $this->cart([[$this->anvil, 1]], 'Germany')->json('data.shipping_options.0.price'));
        // Without a country only "*" rows match.
        $this->assertSame('25.00', $this->cart([[$this->anvil, 1]], null)->json('data.shipping_options.0.price'));
    }

    public function test_variants_can_have_their_own_weight(): void
    {
        $this->rate(['method' => 'standard', 'max_weight_grams' => 1000, 'price' => '3.00']);
        $this->rate(['method' => 'standard', 'min_weight_grams' => 1000, 'price' => '9.00', 'position' => 1]);
        $shirt = $this->product(['price' => '20.00', 'weight' => 300]);
        $this->admin('PUT', "/api/admin/v1/products/{$shirt->id}/options", ['options' => [['name' => 'Size', 'values' => ['S', 'XL']]]])->assertOk();
        $this->admin('POST', "/api/admin/v1/products/{$shirt->id}/variants/generate")->assertOk();
        $variants = $shirt->fresh()->variants;
        $this->admin('PATCH', "/api/admin/v1/products/{$shirt->id}/variants/{$variants[1]->id}", ['weight' => 1500, 'stock_quantity' => 5, 'is_active' => true])->assertOk()
            ->assertJsonPath('data.variants.1.weight', 1500);
        $this->admin('PATCH', "/api/admin/v1/products/{$shirt->id}/variants/{$variants[0]->id}", ['stock_quantity' => 5, 'is_active' => true])->assertOk();

        $small = $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $shirt->id, 'variant_id' => $variants[0]->id, 'quantity' => 1]]]);
        $small->assertOk()->assertJsonPath('data.weight_grams', 300)->assertJsonPath('data.totals.shipping', '3.00');
        $big = $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $shirt->id, 'variant_id' => $variants[1]->id, 'quantity' => 1]]]);
        $big->assertOk()->assertJsonPath('data.weight_grams', 1500)->assertJsonPath('data.totals.shipping', '9.00');
    }

    public function test_free_shipping_still_applies_on_top_of_table_rates(): void
    {
        $this->rate(['method' => 'standard', 'price' => '7.00']);
        $this->rate(['method' => 'express', 'price' => '15.00']);

        // Standard is free from 50.00 (after discounts); express isn't.
        $this->assertSame(['standard' => ['0.00', 'table'], 'express' => ['15.00', 'table'], 'nextDay' => ['24.99', 'flat']],
            $this->shippingPrices($this->cart([[$this->anvil, 2]])));
        // A free-shipping rule makes every method free.
        Coupon::create(['code' => 'SHIPFREE', 'description' => 'Free shipping', 'type' => 'free_shipping', 'value' => '0', 'is_active' => true]);
        $response = $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $this->book->id, 'quantity' => 1]],
            'coupon_code' => 'SHIPFREE', 'shipping_method' => 'express', 'country' => 'United States'])->assertOk();
        $this->assertSame(['standard' => ['0.00', 'table'], 'express' => ['0.00', 'table'], 'nextDay' => ['0.00', 'flat']], $this->shippingPrices($response));
    }

    public function test_checkout_refuses_a_method_that_isnt_offered_and_carts_nobody_can_ship(): void
    {
        $this->rate(['method' => 'express', 'max_weight_grams' => 5000, 'price' => '9.00']);
        $line = [['product_id' => $this->anvil->id, 'quantity' => 1]];

        $this->placeOrder($line, ['shipping_method' => 'express'])->assertStatus(422)
            ->assertJsonPath('errors.shipping_method.0', 'This shipping method isn\'t available for your order. Please choose another one.');
        $this->placeOrder($line, ['shipping_method' => 'standard'])->assertCreated()->assertJsonPath('data.totals.shipping', '4.99');
        $this->placeOrder([['product_id' => $this->book->id, 'quantity' => 1]], ['shipping_method' => 'express'])->assertCreated()
            ->assertJsonPath('data.shipping_method.id', 'express')->assertJsonPath('data.totals.shipping', '9.00');

        // Every method has rows and none matches: nothing can ship this cart.
        $this->rate(['method' => 'standard', 'country' => 'Canada', 'price' => '5.00']);
        $this->rate(['method' => 'nextDay', 'country' => 'Canada', 'price' => '5.00']);
        $this->cart([[$this->anvil, 1]])->assertJsonPath('data.shipping_options', [])->assertJsonPath('data.shipping_method', null)
            ->assertJsonPath('data.shipping_error', 'We can\'t ship this order to United States with the available methods.');
        $this->placeOrder($line, ['shipping_method' => 'standard'])->assertStatus(422)
            ->assertJsonPath('errors.shipping_method.0', 'We can\'t ship this order to United States with the available methods.');
    }

    public function test_admin_orders_follow_the_same_rates(): void
    {
        $this->rate(['method' => 'standard', 'price' => '6.00']);
        $this->rate(['method' => 'express', 'max_weight_grams' => 5000, 'price' => '9.00']);
        $body = [
            'guest' => ['email' => 'phone@example.com', 'phone' => '+15550100100', 'first_name' => 'Pat', 'last_name' => 'Phone'],
            'items' => [['product_id' => $this->anvil->id, 'quantity' => 1]],
            'shipping_address' => ['first_name' => 'Pat', 'last_name' => 'Phone', 'line1' => '1 Main St', 'city' => 'Austin', 'postal_code' => '73301', 'country' => 'United States'],
            'same_as_shipping' => true, 'payment_method' => 'cod',
        ];

        $quote = $this->admin('POST', '/api/admin/v1/orders/quote', $body)->assertOk();
        $this->assertSame(['standard' => ['6.00', 'table'], 'nextDay' => ['24.99', 'flat']], $this->shippingPrices($quote));
        $this->admin('POST', '/api/admin/v1/orders', [...$body, 'shipping_method' => 'express'])->assertStatus(422)->assertJsonValidationErrors('shipping_method');
        $this->admin('POST', '/api/admin/v1/orders', [...$body, 'shipping_method' => 'standard'])->assertCreated()->assertJsonPath('data.totals.shipping', '6.00');
    }

    public function test_staff_manage_rates_and_check_a_cart(): void
    {
        $created = $this->admin('POST', '/api/admin/v1/shipping-rates', [
            'method' => 'standard', 'country' => 'de', 'max_weight_grams' => 2000, 'price' => '5.5',
        ])->assertCreated()->assertJsonPath('data.country', 'Germany')->assertJsonPath('data.price', '5.50')
            ->assertJsonPath('data.min_subtotal', '0.00')->assertJsonPath('data.max_subtotal', null)->assertJsonPath('data.position', 1);
        $second = $this->admin('POST', '/api/admin/v1/shipping-rates', ['method' => 'standard', 'price' => '9.00'])->assertCreated()
            ->assertJsonPath('data.country', '*')->assertJsonPath('data.position', 2);
        $this->admin('POST', '/api/admin/v1/shipping-rates', ['method' => 'standard', 'country' => 'Atlantis', 'price' => '1',
            'min_weight_grams' => 500, 'max_weight_grams' => 100])->assertStatus(422)->assertJsonValidationErrors(['country', 'max_weight_grams']);
        $this->admin('POST', '/api/admin/v1/shipping-rates', ['method' => 'drone', 'price' => '1'])->assertStatus(422)->assertJsonValidationErrors('method');

        $id = $created->json('data.id');
        $this->admin('PATCH', "/api/admin/v1/shipping-rates/{$id}", ['price' => '4.00', 'max_weight_grams' => null])->assertOk()
            ->assertJsonPath('data.price', '4.00')->assertJsonPath('data.max_weight_grams', null)->assertJsonPath('data.country', 'Germany');
        $this->admin('POST', '/api/admin/v1/shipping-rates/reorder', ['method' => 'standard', 'ids' => [$second->json('data.id'), $id]])->assertOk()
            ->assertJsonPath('data.0.id', $second->json('data.id'));
        $this->admin('POST', '/api/admin/v1/shipping-rates/reorder', ['method' => 'standard', 'ids' => [$id]])->assertStatus(422);

        $this->admin('GET', '/api/admin/v1/shipping-rates')->assertOk()->assertJsonCount(2, 'data')
            ->assertJsonPath('meta.default_weight_grams', 500)->assertJsonPath('meta.methods.0', ['id' => 'standard', 'label' => 'Standard', 'flat_price' => '4.99', 'rows' => 2]);

        // The check tool: Germany matches its own row (exact before "*"); express has no rows (flat).
        $this->admin('POST', '/api/admin/v1/shipping-rates/check', ['country' => 'Germany', 'weight_grams' => 3000, 'subtotal' => '80.00'])->assertOk()
            ->assertJsonPath('data.0', ['method' => 'standard', 'label' => 'Standard', 'available' => true, 'price' => '4.00', 'source' => 'table', 'rate_id' => $id, 'zone_code' => null, 'eta_days_min' => null, 'eta_days_max' => null]) // phase 14: the last three
            ->assertJsonPath('data.1', ['method' => 'express', 'label' => 'Express', 'available' => true, 'price' => '12.99', 'source' => 'flat', 'rate_id' => null, 'zone_code' => null, 'eta_days_min' => null, 'eta_days_max' => null]);

        $this->admin('DELETE', "/api/admin/v1/shipping-rates/{$id}")->assertNoContent();
        $this->admin('DELETE', "/api/admin/v1/shipping-rates/{$id}")->assertNotFound();
        $this->assertDatabaseHas('audit_log', ['action' => 'shipping_rate.created']);
        $this->assertDatabaseHas('audit_log', ['action' => 'shipping_rate.deleted']);

        // settings.view may read, not change.
        $viewer = $this->signInAdmin(Admin::factory()->role('Viewer')->create());
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/shipping-rates')->assertOk();
        $this->asAdmin($viewer, 'POST', '/api/admin/v1/shipping-rates', ['method' => 'standard', 'price' => '1'])->assertForbidden();
    }

    public function test_csv_export_and_import(): void
    {
        $this->rate(['method' => 'standard', 'price' => '9.00']);
        $this->rate(['method' => 'express', 'price' => '19.00']);

        $csv = $this->admin('GET', '/api/admin/v1/shipping-rates/export.csv')->assertOk()->getContent();
        $this->assertStringStartsWith('method,country,min_weight_grams,max_weight_grams,min_subtotal,max_subtotal,price,position', ltrim($csv, "\u{FEFF}"));
        $this->assertStringContainsString('standard,*,0,,0.00,,9.00,0', $csv);

        $file = UploadedFile::fake()->createWithContent('rates.csv',
            "method,country,min_weight_grams,max_weight_grams,min_subtotal,max_subtotal,price,position\n"
            ."standard,US,0,1000,,,3.00,\nstandard,*,1000,,,,7.00,\n");
        $this->withHeaders($this->admin)->post('/api/admin/v1/shipping-rates/import', ['file' => $file], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('data', ['imported' => 2, 'replaced' => 1]);
        // Replaced only the methods in the file: express stays.
        $this->assertEquals(['standard' => 2, 'express' => 1], ShippingRate::get()->countBy('method')->all());
        $this->assertSame([['United States', 0], ['*', 1]], ShippingRate::where('method', 'standard')->orderBy('position')->get()
            ->map(fn ($r) => [$r->country, $r->position])->all());

        // A bad row: nothing is saved.
        $bad = UploadedFile::fake()->createWithContent('bad.csv', "method,country,price\nstandard,*,2.00\nexpress,*,free\n");
        $this->withHeaders($this->admin)->post('/api/admin/v1/shipping-rates/import', ['file' => $bad], ['Accept' => 'application/json'])
            ->assertStatus(422)->assertJsonValidationErrors('rows.3.price');
        $this->assertSame(3, ShippingRate::count());
        $this->assertSame(0, Order::count());
    }
}
