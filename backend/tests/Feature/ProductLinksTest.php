<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductLink;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 11: product specifications, comparison, and related products / up-sells / cross-sells. */
class ProductLinksTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = $this->adminHeaders();
    }

    private function admin(string $method, string $uri, array $body = []): TestResponse
    {
        return $this->asAdmin($this->admin, $method, $uri, $body);
    }

    private function import(string $csv): TestResponse
    {
        $this->app['auth']->forgetGuards();
        $file = UploadedFile::fake()->createWithContent('products.csv', $csv);

        return $this->post('/api/admin/v1/products/import', ['file' => $file, 'dry_run' => '0'], [...$this->admin, 'Accept' => 'application/json']);
    }

    // ---- Specifications and comparison ---------------------------------------------

    public function test_specifications_are_validated_saved_and_shown(): void
    {
        $product = $this->product();
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['specifications' => [
            ['label' => 'Battery', 'value' => '20 h'], ['label' => 'battery', 'value' => 'x'],
        ]])->assertStatus(422)->assertJsonValidationErrors('specifications.1.label');
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['specifications' => [['label' => str_repeat('a', 61), 'value' => 'x']]])
            ->assertStatus(422)->assertJsonValidationErrors('specifications.0.label');
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['specifications' => [['label' => 'A', 'value' => str_repeat('a', 256)]]])
            ->assertStatus(422)->assertJsonValidationErrors('specifications.0.value');
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['specifications' => array_map(fn ($i) => ['label' => "L{$i}", 'value' => 'v'], range(1, 41))])
            ->assertStatus(422)->assertJsonValidationErrors('specifications');

        $rows = [['label' => 'Battery', 'value' => '20 h'], ['label' => 'Weight', 'value' => '250 g']];
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['specifications' => [['label' => ' Battery ', 'value' => '20 h '], $rows[1]]])
            ->assertOk()->assertJsonPath('data.specifications', array_map(fn ($row) => [...$row, 'label_bn' => null, 'value_bn' => null], $rows)); // phase 13: admin rows
        $this->getJson("/api/v1/products/{$product->id}")->assertOk()->assertJsonPath('data.specifications', $rows);
        // Left out: unchanged; null clears.
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['name' => 'Renamed'])->assertOk()
            ->assertJsonPath('data.specifications', array_map(fn ($row) => [...$row, 'label_bn' => null, 'value_bn' => null], $rows));
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['specifications' => null])->assertOk()->assertJsonPath('data.specifications', []);
    }

    public function test_compare_takes_two_to_four_visible_products_in_order(): void
    {
        $a = $this->product(['name' => 'Alpha', 'description' => '<p>Small and light.</p>', 'specifications' => [['label' => 'Battery', 'value' => '20 h']]]);
        $b = $this->product(['name' => 'Beta']);
        $hidden = $this->product(['status' => 'draft']);

        $this->getJson("/api/v1/products/compare?ids={$b->id},{$a->id},{$hidden->id},999999")->assertOk()->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.name', 'Beta')->assertJsonPath('data.1.name', 'Alpha')
            ->assertJsonPath('data.1.specifications', [['label' => 'Battery', 'value' => '20 h']])
            ->assertJsonPath('data.1.description_short', 'Small and light.')->assertJsonPath('data.1.options', [])
            ->assertJsonPath('data.1.sale_price', '10.00')->assertJsonPath('data.1.availability', 'in_stock');

        $this->getJson("/api/v1/products/compare?ids={$a->id}")->assertStatus(422)->assertJsonValidationErrors('ids');
        $this->getJson("/api/v1/products/compare?ids={$a->id},{$a->id}")->assertStatus(422)->assertJsonValidationErrors('ids');
        $ids = Product::factory()->count(5)->create()->pluck('id')->implode(',');
        $this->getJson("/api/v1/products/compare?ids={$ids}")->assertStatus(422)->assertJsonValidationErrors('ids');
        $this->getJson('/api/v1/products/compare?ids=1,abc')->assertStatus(422);
        $this->getJson('/api/v1/products/compare')->assertStatus(422);
    }

    // ---- Product links ----------------------------------------------------------------

    public function test_links_are_saved_replaced_and_validated(): void
    {
        $product = $this->product();
        [$a, $b, $c] = [$this->product(['name' => 'A']), $this->product(['name' => 'B']), $this->product(['name' => 'C'])];

        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['links' => ['related' => [$product->id]]])
            ->assertStatus(422)->assertJsonValidationErrors('links.related.0');
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['links' => ['upsell' => [999999]]])
            ->assertStatus(422)->assertJsonValidationErrors('links.upsell.0');
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['links' => ['crosssell' => [$a->id, $a->id]]])
            ->assertStatus(422)->assertJsonValidationErrors('links.crosssell.0');
        $many = Product::factory()->count(21)->create()->pluck('id')->all();
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['links' => ['related' => $many]])
            ->assertStatus(422)->assertJsonValidationErrors('links.related');

        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['links' => ['related' => [$b->id, $a->id], 'upsell' => [$c->id]]])->assertOk()
            ->assertJsonPath('data.links.related.0.id', $b->id)->assertJsonPath('data.links.related.1.name', 'A')
            ->assertJsonPath('data.links.related.0.sku', $b->sku)->assertJsonPath('data.links.related.0.status', 'active')
            ->assertJsonPath('data.links.upsell.0.id', $c->id)->assertJsonPath('data.links.crosssell', []);
        // A type left out is unchanged; a list replaces its type.
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['links' => ['related' => [$c->id]]])->assertOk()
            ->assertJsonPath('data.links.related.0.id', $c->id)->assertJsonCount(1, 'data.links.related')->assertJsonPath('data.links.upsell.0.id', $c->id);
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['name' => 'No links sent'])->assertOk()->assertJsonCount(1, 'data.links.related');
        $this->assertDatabaseHas('audit_log', ['action' => 'product.updated', 'subject_id' => $product->id]);

        // Creating with links; deleting a linked product removes its links.
        $category = Category::factory()->create();
        $id = $this->admin('POST', '/api/admin/v1/products', ['name' => 'Bundle', 'category' => $category->slug, 'price' => 5, 'stock_quantity' => 1,
            'links' => ['crosssell' => [$a->id]]])->assertCreated()->assertJsonPath('data.links.crosssell.0.id', $a->id)->json('data.id');
        $this->admin('DELETE', "/api/admin/v1/products/{$a->id}")->assertNoContent();
        $this->assertSame(0, ProductLink::where('linked_product_id', $a->id)->count());
        $this->admin('GET', "/api/admin/v1/products/{$id}")->assertOk()->assertJsonPath('data.links.crosssell', []);
    }

    public function test_the_product_page_shows_related_products_with_a_fallback_and_upsells(): void
    {
        $category = Category::factory()->create();
        $product = $this->product(['category_id' => $category->id, 'rating_average' => '3.00']);
        $best = $this->product(['category_id' => $category->id, 'rating_average' => '4.90']);
        $good = $this->product(['category_id' => $category->id, 'rating_average' => '4.10']);
        $elsewhere = $this->product(['rating_average' => '5.00']);

        // No related links: the same category, best rated first, never the product itself.
        $related = $this->getJson("/api/v1/products/{$product->id}")->assertOk()->assertJsonPath('data.upsells', [])->json('data.related');
        $this->assertSame([$best->id, $good->id], array_column($related, 'id'));

        $soldOut = $this->product(['stock_quantity' => 0]);
        $hidden = $this->product(['status' => 'draft']);
        $up = $this->product();
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['links' => [
            'related' => [$soldOut->id, $hidden->id, $elsewhere->id], 'upsell' => [$up->id],
        ]])->assertOk();
        $data = $this->getJson("/api/v1/products/{$product->id}")->assertOk()->json('data');
        // In stock first, hidden left out.
        $this->assertSame([$elsewhere->id, $soldOut->id], array_column($data['related'], 'id'));
        $this->assertSame([$up->id], array_column($data['upsells'], 'id'));
        $this->assertArrayHasKey('sale_price', $data['related'][0]);

        // Only hidden related products: back to the automatic choice.
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['links' => ['related' => [$hidden->id]]])->assertOk();
        $this->assertSame([$best->id, $good->id], array_column($this->getJson("/api/v1/products/{$product->id}")->json('data.related'), 'id'));
        // Lists of products don't carry them.
        $this->assertArrayNotHasKey('related', $this->getJson('/api/v1/products')->json('data.0'));
    }

    public function test_cart_validation_answers_cross_sells(): void
    {
        [$a, $b] = [$this->product(), $this->product()];
        [$x, $y, $z] = [$this->product(['name' => 'X']), $this->product(['name' => 'Y']), $this->product(['name' => 'Z'])];
        $hidden = $this->product(['status' => 'archived']);
        $this->admin('PATCH', "/api/admin/v1/products/{$a->id}", ['links' => ['crosssell' => [$z->id, $y->id, $b->id, $hidden->id]]])->assertOk();
        $this->admin('PATCH', "/api/admin/v1/products/{$b->id}", ['links' => ['crosssell' => [$x->id, $y->id]]])->assertOk();

        $cross = $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $a->id, 'quantity' => 1], ['product_id' => $b->id, 'quantity' => 1]]])
            ->assertOk()->json('data.cross_sells');
        // Y (2 links) first, then by position (Z 0, X 0 → id), B is in the cart, hidden left out.
        $this->assertSame([$y->id, $x->id, $z->id], array_column($cross, 'id'));
        $this->postJson('/api/v1/cart/validate', ['items' => []])->assertOk()->assertJsonPath('data.cross_sells', []);
    }

    public function test_csv_export_and_import_of_specifications_and_links(): void
    {
        $category = Category::factory()->create(['slug' => 'audio']);
        $a = $this->product(['sku' => 'AUD-1', 'name' => 'Speaker', 'category_id' => $category->id,
            'specifications' => [['label' => 'Battery', 'value' => '20 h'], ['label' => 'Weight', 'value' => '250 g']]]);
        $b = $this->product(['sku' => 'AUD-2', 'name' => 'Cable', 'category_id' => $category->id]);
        ProductLink::create(['product_id' => $a->id, 'linked_product_id' => $b->id, 'type' => 'crosssell', 'position' => 0]);

        $this->app['auth']->forgetGuards();
        $csv = $this->get('/api/admin/v1/products/export.csv', $this->admin)->assertOk()->getContent();
        $lines = array_map(fn ($line) => str_getcsv($line, escape: ''), array_filter(explode("\n", trim($csv))));
        $header = $lines[0];
        $this->assertSame(['specifications', 'related_skus', 'upsell_skus', 'crosssell_skus'], array_slice($header, -9, 4)); // phase 13: 5 Bangla columns follow
        $row = collect($lines)->first(fn ($line) => $line[0] === 'AUD-1');
        $this->assertSame('Battery: 20 h | Weight: 250 g', $row[11]);
        $this->assertSame('AUD-2', $row[14]);

        // Import: a new product linked from an existing one in the same file, an unknown SKU as a warning.
        $response = $this->import("sku,name,category_slug,price,specifications,related_skus,upsell_skus\n"
            ."AUD-2,Cable,,,Length: 1 m,AUD-3|NOPE|AUD-2,\n"
            ."AUD-3,Adapter,audio,4.00,,,AUD-1\n")->assertOk();
        $response->assertJsonPath('data.errors', [])->assertJsonPath('data.created', 1)->assertJsonPath('data.updated', 1)
            ->assertJsonCount(2, 'data.warnings')->assertJsonPath('data.warnings.0.row', 2)->assertJsonPath('data.warnings.0.column', 'related_skus');
        $adapter = Product::where('sku', 'AUD-3')->firstOrFail();
        $this->assertSame([['label' => 'Length', 'value' => '1 m']], $b->fresh()->specifications);
        $this->assertSame([$adapter->id], ProductLink::where('product_id', $b->id)->where('type', 'related')->pluck('linked_product_id')->all());
        $this->assertSame([$a->id], ProductLink::where('product_id', $adapter->id)->where('type', 'upsell')->pluck('linked_product_id')->all());
        // Cross-sells weren't in the file: unchanged.
        $this->assertSame(1, ProductLink::where('product_id', $a->id)->where('type', 'crosssell')->count());

        $this->import("sku,name,specifications\nAUD-1,Speaker,No colon here\n")->assertOk()
            ->assertJsonPath('data.errors.0.column', 'specifications');
        $this->import("sku,name,specifications\nAUD-1,Speaker,A: 1 | a: 2\n")->assertOk()
            ->assertJsonPath('data.errors.0.column', 'specifications');
    }

    public function test_duplicate_copies_the_product_with_its_specifications_and_links(): void
    {
        $a = $this->product(['sku' => 'LAMP-1', 'name' => 'Desk Lamp', 'price' => '20.00', 'specifications' => [['label' => 'Power', 'value' => '5 W']]]);
        $b = $this->product();
        ProductLink::create(['product_id' => $a->id, 'linked_product_id' => $b->id, 'type' => 'related', 'position' => 0]);
        $a->images()->create(['url' => 'https://cdn.example.com/lamp.webp', 'alt' => 'Lamp', 'position' => 0]);

        $copy = $this->admin('POST', "/api/admin/v1/products/{$a->id}/duplicate")->assertCreated()
            ->assertJsonPath('data.name', 'Desk Lamp (copy)')->assertJsonPath('data.sku', 'LAMP-1-COPY')->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.price', '20.00')->assertJsonPath('data.specifications', [['label' => 'Power', 'value' => '5 W', 'label_bn' => null, 'value_bn' => null]])
            ->assertJsonPath('data.links.related.0.id', $b->id)->assertJsonPath('data.images.0.url', 'https://cdn.example.com/lamp.webp')->json('data');
        $this->assertNotSame($a->slug, Product::find($copy['id'])->slug);
        $this->admin('POST', "/api/admin/v1/products/{$a->id}/duplicate")->assertCreated()->assertJsonPath('data.sku', 'LAMP-1-COPY-2');
        $this->assertDatabaseHas('audit_log', ['action' => 'product.duplicated', 'subject_id' => $copy['id']]);

        $viewer = $this->signInAdmin(Admin::factory()->role(['products.view'])->create());
        $this->asAdmin($viewer, 'POST', "/api/admin/v1/products/{$a->id}/duplicate")->assertForbidden();
        $this->admin('POST', '/api/admin/v1/products/999999/duplicate')->assertNotFound();
    }
}
