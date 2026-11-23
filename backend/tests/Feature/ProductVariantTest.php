<?php

namespace Tests\Feature;

use App\Mail\OrderPlacedMail;
use App\Models\AuditLog;
use App\Models\Order;
use App\Models\Product;
use App\Models\ProductVariant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 5: configurable products (options and variants), from the admin to the refund. */
class ProductVariantTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    private Product $shirt;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
        $this->shirt = $this->product(['sku' => 'TEE-1', 'name' => 'Tee', 'price' => '20.00', 'discount_percent' => '10.00', 'stock_quantity' => 50]);
    }

    private function setOptions(array $options)
    {
        return $this->asAdmin($this->admin, 'PUT', "/api/admin/v1/products/{$this->shirt->id}/options", ['options' => $options]);
    }

    /** Size S/M, Color Red: two variants, generated and switched on with stock. Returns [S/Red, M/Red]. */
    private function configure(): array
    {
        $this->setOptions([['name' => 'Size', 'values' => ['S', 'M']], ['name' => 'Color', 'values' => ['Red']]])->assertOk();
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/products/{$this->shirt->id}/variants/generate")->assertOk();
        $variants = ProductVariant::orderBy('id')->get();
        $this->patchVariant($variants[0], ['stock_quantity' => 3, 'is_active' => true])->assertOk();
        $this->patchVariant($variants[1], ['stock_quantity' => 5, 'is_active' => true, 'price' => '30.00'])->assertOk();

        return [$variants[0]->fresh(), $variants[1]->fresh()];
    }

    private function patchVariant(ProductVariant $variant, array $body)
    {
        return $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$this->shirt->id}/variants/{$variant->id}", $body);
    }

    public function test_options_generate_variants_and_the_admin_detail(): void
    {
        $response = $this->setOptions([['name' => 'Size', 'values' => ['S', 'M']], ['name' => 'Color', 'values' => ['Red', 'Blue']]])->assertOk()
            ->assertJsonPath('data.has_variants', true)
            ->assertJsonPath('data.options.0.name', 'Size')
            ->assertJsonPath('data.options.1.values.1.value', 'Blue')
            ->assertJsonPath('data.variants', []);
        $this->assertSame(['id', 'name', 'name_bn', 'position', 'values'], array_keys($response->json('data.options.0'))); // phase 13: name_bn

        $generated = $this->asAdmin($this->admin, 'POST', "/api/admin/v1/products/{$this->shirt->id}/variants/generate")->assertOk()
            ->assertJsonPath('meta.created', 4)->json('data.variants');
        $this->assertSame(['TEE-1-S-RED', 'TEE-1-S-BLUE', 'TEE-1-M-RED', 'TEE-1-M-BLUE'], array_column($generated, 'sku'));
        $this->assertSame(['id', 'sku', 'option_value_ids', 'label', 'price', 'effective_price', 'final_price', 'stock_quantity', 'weight', 'is_active', 'is_current',
            'created_at', 'updated_at'], array_keys($generated[0])); // phase 10 (part B): weight
        $this->assertSame('Size: S / Color: Red', $generated[0]['label']);
        $this->assertSame([null, '20.00', '18.00', 0, false], [$generated[0]['price'], $generated[0]['effective_price'], $generated[0]['final_price'],
            $generated[0]['stock_quantity'], $generated[0]['is_active']]);

        // Running it again adds nothing.
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/products/{$this->shirt->id}/variants/generate")->assertJsonPath('meta.created', 0);
        $this->assertSame(1, AuditLog::where('action', 'product.variants_generated')->count());
        $this->assertSame(1, AuditLog::where('action', 'product.options_updated')->count());
    }

    public function test_option_limits(): void
    {
        $this->setOptions(array_map(fn ($i) => ['name' => "O{$i}", 'values' => ['a']], range(1, 4)))->assertJsonValidationErrors('options');
        $this->setOptions([['name' => 'Size', 'values' => array_map(fn ($i) => "v{$i}", range(1, 21))]])->assertJsonValidationErrors('options.0.values');
        $this->setOptions([['name' => 'Size', 'values' => ['M', 'm']]])->assertJsonValidationErrors('options.0.values.1');
        $this->setOptions([['name' => 'Size', 'values' => ['M']], ['name' => 'size', 'values' => ['L']]])->assertJsonValidationErrors('options.1.name');
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/products/{$this->shirt->id}/variants/generate")->assertJsonValidationErrors('options');
    }

    public function test_variant_edits_stock_sum_and_sku_uniqueness(): void
    {
        [$small, $medium] = $this->configure();
        $this->assertSame(8, $this->shirt->fresh()->stock_quantity); // 3 + 5: the active variants' stock

        $this->patchVariant($small, ['sku' => $this->product()->sku])->assertJsonValidationErrors('sku');
        $this->patchVariant($small, ['sku' => $medium->sku])->assertJsonValidationErrors('sku');
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$this->product()->id}", ['sku' => $small->sku])->assertJsonValidationErrors('sku');
        $this->patchVariant($small, ['price' => '0.00'])->assertJsonValidationErrors('price');

        $this->patchVariant($medium, ['is_active' => false])->assertOk()->assertJsonPath('data.stock_quantity', 3);
        // The product's own stock is ignored for a product with variants.
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$this->shirt->id}", ['stock_quantity' => 99])->assertOk()
            ->assertJsonPath('data.stock_quantity', 3);

        $entry = AuditLog::where('action', 'product.variant_updated')->latest('id')->first();
        $this->assertSame(['is_active' => false], $entry->changes['after']);
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$this->product()->id}/variants/{$small->id}", ['stock_quantity' => 1])->assertNotFound();
    }

    public function test_removing_a_value_deactivates_its_variants_but_keeps_them(): void
    {
        [$small, $medium] = $this->configure();

        $this->setOptions([['name' => 'size', 'values' => ['M', 'L']], ['name' => 'Color', 'values' => ['Red']]])->assertOk();

        $this->assertFalse($small->fresh()->is_active); // S is gone
        $this->assertTrue($medium->fresh()->is_active);  // M kept its id (matched by name, ignoring case)
        $this->assertSame(2, ProductVariant::count());
        $this->assertSame(5, $this->shirt->fresh()->stock_quantity);
        $this->patchVariant($small, ['is_active' => true])->assertJsonValidationErrors('is_active');

        $detail = $this->asAdmin($this->admin, 'GET', "/api/admin/v1/products/{$this->shirt->id}")->json('data');
        $this->assertSame('size', $detail['options'][0]['name']); // renamed to what was sent
        $this->assertFalse(collect($detail['variants'])->firstWhere('id', $small->id)['is_current']);

        // No options: a simple product again.
        $this->setOptions([])->assertOk()->assertJsonPath('data.has_variants', false)->assertJsonPath('data.options', []);
        $this->assertFalse($medium->fresh()->is_active);
    }

    public function test_the_storefront_shows_options_and_active_variants(): void
    {
        [$small, $medium] = $this->configure();
        $this->patchVariant($small, ['stock_quantity' => 0])->assertOk();

        $data = $this->getJson("/api/v1/products/{$this->shirt->id}")->assertOk()->json('data');
        $this->assertTrue($data['has_variants']);
        $this->assertSame(['id', 'name', 'values'], array_keys($data['options'][0]));
        $this->assertSame(['id', 'value'], array_keys($data['options'][0]['values'][0]));
        $this->assertSame(['id' => $medium->id, 'sku' => $medium->sku, 'option_value_ids' => $medium->option_value_ids,
            'price' => '30.00', 'final_price' => '27.00', 'stock_quantity' => 5, 'in_stock' => true], $data['variants'][1]);
        $this->assertFalse($data['variants'][0]['in_stock']);
        $this->assertSame(5, $data['stock_quantity']);

        $this->patchVariant($small, ['is_active' => false])->assertOk();
        $this->assertCount(1, $this->getJson("/api/v1/products/{$this->shirt->id}")->json('data.variants'));

        $this->assertTrue(collect($this->getJson('/api/v1/products')->json('data'))->firstWhere('id', $this->shirt->id)['has_variants']);
        $simple = $this->product();
        $this->getJson("/api/v1/products/{$simple->id}")->assertJsonPath('data.options', [])->assertJsonPath('data.variants', [])
            ->assertJsonPath('data.has_variants', false);
    }

    public function test_cart_lines_need_a_valid_active_variant(): void
    {
        [$small, $medium] = $this->configure();
        $other = $this->product();
        $otherVariant = ProductVariant::create(['product_id' => $other->id, 'sku' => 'OTHER-1', 'option_value_ids' => [], 'option_key' => '', 'is_active' => true]);
        $this->patchVariant($small, ['is_active' => false])->assertOk();

        $lines = [
            ['product_id' => $this->shirt->id, 'quantity' => 1],                                  // no variant
            ['product_id' => $this->shirt->id, 'variant_id' => $small->id, 'quantity' => 1],      // inactive
            ['product_id' => $this->shirt->id, 'variant_id' => $otherVariant->id, 'quantity' => 1], // another product's
            ['product_id' => $this->shirt->id, 'variant_id' => $medium->id, 'quantity' => 2],     // fine
        ];
        $response = $this->postJson('/api/v1/cart/validate', ['items' => $lines])->assertOk();
        $this->assertSame([[null, 'variant_required'], [$small->id, 'variant_unavailable'], [$otherVariant->id, 'variant_unavailable']],
            array_map(fn ($p) => [$p['variant_id'], $p['code']], $response->json('data.problems')));
        $this->assertSame([false, false, false, true], array_column($response->json('data.lines'), 'available'));
        $response->assertJsonPath('data.lines.3.sku', $medium->sku)
            ->assertJsonPath('data.lines.3.variant_label', 'Size: M / Color: Red')
            ->assertJsonPath('data.lines.3.price', '30.00')
            ->assertJsonPath('data.lines.3.sale_price', '27.00')
            ->assertJsonPath('data.lines.3.line_total', '54.00')
            ->assertJsonPath('data.lines.3.stock_quantity', 5)
            ->assertJsonPath('data.totals.subtotal', '54.00');

        $this->placeOrder([$lines[0]])->assertUnprocessable()->assertJsonPath('problems.0.code', 'variant_required');
        $this->placeOrder([$lines[2]])->assertUnprocessable()->assertJsonPath('problems.0.code', 'variant_unavailable');
        // A simple product with a variant id is refused too.
        $this->placeOrder([['product_id' => $other->id, 'variant_id' => $medium->id, 'quantity' => 1]])->assertUnprocessable()
            ->assertJsonPath('problems.0.code', 'variant_unavailable');
        $this->assertSame(0, Order::count());
    }

    public function test_checkout_takes_the_variants_stock_and_remembers_the_variant(): void
    {
        [$small, $medium] = $this->configure();

        // Two variants of one product are two lines; stock is checked per variant.
        $this->placeOrder([['product_id' => $this->shirt->id, 'variant_id' => $small->id, 'quantity' => 4]])->assertUnprocessable()
            ->assertJsonPath('problems.0.code', 'insufficient_stock')
            ->assertJsonPath('problems.0.message', 'Only 3 of Tee (Size: S / Color: Red) left in stock.');

        $response = $this->placeOrder([
            ['product_id' => $this->shirt->id, 'variant_id' => $small->id, 'quantity' => 2],
            ['product_id' => $this->shirt->id, 'variant_id' => $medium->id, 'quantity' => 1],
        ])->assertCreated();

        $response->assertJsonPath('data.items.0.variant_id', $small->id)
            ->assertJsonPath('data.items.0.variant_label', 'Size: S / Color: Red')
            ->assertJsonPath('data.items.0.sku', $small->sku)
            ->assertJsonPath('data.items.0.sale_price', '18.00')
            ->assertJsonPath('data.items.1.sku', $medium->sku)
            ->assertJsonPath('data.items.1.sale_price', '27.00')
            ->assertJsonPath('data.totals.subtotal', '63.00');
        $this->assertSame([1, 4], [$small->fresh()->stock_quantity, $medium->fresh()->stock_quantity]);
        $this->assertSame(5, $this->shirt->fresh()->stock_quantity);

        Mail::assertSent(OrderPlacedMail::class, fn ($mail) => str_contains($mail->render(), 'Tee (Size: S / Color: Red)'));

        // The admin and the invoice show it too.
        $number = $response->json('data.number');
        $this->asAdmin($this->admin, 'GET', "/api/admin/v1/orders/{$number}")->assertJsonPath('data.items.1.variant_label', 'Size: M / Color: Red');
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/invoices/'.Order::sole()->invoices()->value('number'))
            ->assertJsonPath('data.items.0.variant_label', 'Size: S / Color: Red');
    }

    public function test_refunds_and_cancellations_restock_the_variant(): void
    {
        [$small, $medium] = $this->configure();
        $number = $this->placeOrder([['product_id' => $this->shirt->id, 'variant_id' => $small->id, 'quantity' => 2]])->assertCreated()->json('data.number');
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();
        $item = Order::sole()->items->sole();

        $this->asAdmin($this->admin, 'GET', "/api/admin/v1/orders/{$number}/refundable")->assertJsonPath('data.items.0.variant_label', 'Size: S / Color: Red');
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$number}/credit-memos", [
            'items' => [['order_item_id' => $item->id, 'quantity' => 1]], 'restock' => true,
        ])->assertCreated()->assertJsonPath('data.items.0.variant_label', 'Size: S / Color: Red');

        $this->assertSame(2, $small->fresh()->stock_quantity); // 3 − 2 + 1
        $this->assertSame(7, $this->shirt->fresh()->stock_quantity); // 2 + 5

        // Cancelling (an uninvoiced order) gives the variant its units back as well.
        $second = $this->placeOrder([['product_id' => $this->shirt->id, 'variant_id' => $medium->id, 'quantity' => 4]])->assertCreated()->json('data.number');
        $this->assertSame(1, $medium->fresh()->stock_quantity);
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/orders/{$second}", ['status' => 'cancelled'])->assertOk();
        $this->assertSame(5, $medium->fresh()->stock_quantity);
        $this->assertSame(7, $this->shirt->fresh()->stock_quantity);
    }

    public function test_checkout_locks_the_variant_row(): void
    {
        [$small] = $this->configure();
        $queries = [];
        DB::listen(function ($query) use (&$queries) {
            $queries[] = $query->sql;
        });

        $this->placeOrder([['product_id' => $this->shirt->id, 'variant_id' => $small->id, 'quantity' => 1]])->assertCreated();

        $this->assertNotEmpty(array_filter($queries, fn ($sql) => str_contains($sql, 'from `product_variants`') && str_contains($sql, 'for update')));
        $this->assertNotEmpty(array_filter($queries, fn ($sql) => str_contains($sql, 'from `products`') && str_contains($sql, 'for update')));
    }
}
