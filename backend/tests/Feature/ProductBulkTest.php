<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductVariant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 5: mass actions on the product grid. All or nothing; one audit entry per product. */
class ProductBulkTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = $this->adminHeaders();
    }

    private function bulk(array $body, ?array $headers = null)
    {
        return $this->asAdmin($headers ?? $this->admin, 'POST', '/api/admin/v1/products/bulk', $body);
    }

    public function test_status_actions(): void
    {
        $a = $this->product();
        $b = $this->product(['status' => 'draft']);
        $ids = [$a->id, $b->id];

        $this->bulk(['ids' => $ids, 'action' => 'disable'])->assertOk()->assertExactJson(['data' => ['updated' => 2, 'skipped' => []]]);
        $this->assertSame(['draft', 'draft'], [$a->fresh()->status, $b->fresh()->status]);
        $this->bulk(['ids' => $ids, 'action' => 'enable'])->assertOk();
        $this->assertSame(['active', 'active'], [$a->fresh()->status, $b->fresh()->status]);
        $this->bulk(['ids' => $ids, 'action' => 'archive'])->assertOk();
        $this->assertSame(['archived', 'archived'], [$a->fresh()->status, $b->fresh()->status]);

        // One entry per product that changed: disable (a), enable (a, b), archive (a, b).
        $this->assertSame(5, AuditLog::where('action', 'product.updated')->count());
        $this->assertSame(['status' => 'archived'], AuditLog::where('subject_id', $a->id)->latest('id')->first()->changes['after']);
    }

    public function test_set_category_and_delete(): void
    {
        $products = Product::factory()->count(3)->create();
        $target = Category::factory()->create(['slug' => 'target']);

        $this->bulk(['ids' => $products->pluck('id')->all(), 'action' => 'set_category', 'value' => $target->id])->assertOk()->assertJsonPath('data.updated', 3);
        $this->assertSame(3, Product::where('category_id', $target->id)->count());
        $this->bulk(['ids' => [$products[0]->id], 'action' => 'set_category', 'value' => 999999])->assertJsonValidationErrors('value');

        $this->bulk(['ids' => [$products[0]->id, $products[1]->id], 'action' => 'delete'])->assertOk()->assertJsonPath('data.updated', 2);
        $this->assertSoftDeleted($products[0]);
        $this->assertSame(2, AuditLog::where('action', 'product.deleted')->count());
        // Deleted products can't be acted on again: the whole request is refused.
        $this->bulk(['ids' => [$products[0]->id, $products[2]->id], 'action' => 'archive'])->assertJsonValidationErrors(['ids' => (string) $products[0]->id]);
        $this->assertSame('active', $products[2]->fresh()->status);
    }

    public function test_adjust_price_is_all_or_nothing(): void
    {
        $cheap = $this->product(['price' => '1.00', 'name' => 'Cheap Thing', 'sku' => 'CHEAP-1']);
        $mid = $this->product(['price' => '19.99']);

        $this->bulk(['ids' => [$cheap->id, $mid->id], 'action' => 'adjust_price', 'value' => ['mode' => 'percent', 'amount' => 10]])->assertOk();
        $this->assertSame(['1.10', '21.99'], [$cheap->fresh()->price, $mid->fresh()->price]);

        // −1.10 would make Cheap 0.00: nothing changes, and the 422 names it.
        $this->bulk(['ids' => [$mid->id, $cheap->id], 'action' => 'adjust_price', 'value' => ['mode' => 'fixed', 'amount' => '-1.10']])
            ->assertJsonValidationErrors(['value.amount' => 'Cheap Thing (CHEAP-1)']);
        $this->assertSame(['1.10', '21.99'], [$cheap->fresh()->price, $mid->fresh()->price]);

        $this->bulk(['ids' => [$mid->id], 'action' => 'adjust_price', 'value' => ['mode' => 'fixed', 'amount' => '-1.99']])->assertOk();
        $this->assertSame('20.00', $mid->fresh()->price);
        $this->bulk(['ids' => [$mid->id], 'action' => 'adjust_price', 'value' => ['mode' => 'percent', 'amount' => -100]])->assertJsonValidationErrors('value.amount');
        $this->bulk(['ids' => [$mid->id], 'action' => 'adjust_price', 'value' => ['mode' => 'double', 'amount' => 2]])->assertJsonValidationErrors('value.mode');
        $this->assertSame(3, AuditLog::where('action', 'product.updated')->count());
    }

    public function test_adjust_price_changes_variant_prices_too(): void
    {
        $product = $this->product(['price' => '10.00']);
        $product->forceFill(['has_variants' => true])->save();
        $own = ProductVariant::create(['product_id' => $product->id, 'sku' => 'V-1', 'option_value_ids' => [1], 'option_key' => '1', 'price' => '12.00']);
        $inherits = ProductVariant::create(['product_id' => $product->id, 'sku' => 'V-2', 'option_value_ids' => [2], 'option_key' => '2', 'price' => null]);

        $this->bulk(['ids' => [$product->id], 'action' => 'adjust_price', 'value' => ['mode' => 'percent', 'amount' => '-50']])->assertOk();
        $this->assertSame(['5.00', '6.00', null], [$product->fresh()->price, $own->fresh()->price, $inherits->fresh()->price]);
    }

    public function test_set_stock_skips_products_with_variants(): void
    {
        $simple = $this->product(['stock_quantity' => 1]);
        $configurable = $this->product(['stock_quantity' => 4]);
        $configurable->forceFill(['has_variants' => true])->save();

        $this->bulk(['ids' => [$simple->id, $configurable->id], 'action' => 'set_stock', 'value' => 25])->assertOk()
            ->assertJsonPath('data.updated', 1)
            ->assertJsonPath('data.skipped.0.id', $configurable->id)
            ->assertJsonPath('data.skipped.0.reason', 'This product has variants: set the stock of each variant instead.');
        $this->assertSame([25, 4], [$simple->fresh()->stock_quantity, $configurable->fresh()->stock_quantity]);
        $this->bulk(['ids' => [$simple->id], 'action' => 'set_stock', 'value' => -1])->assertJsonValidationErrors('value');
    }

    public function test_validation_and_permissions(): void
    {
        $product = $this->product();

        $this->bulk(['ids' => [], 'action' => 'enable'])->assertJsonValidationErrors('ids');
        $this->bulk(['ids' => range(1, 201), 'action' => 'enable'])->assertJsonValidationErrors('ids');
        $this->bulk(['ids' => [$product->id], 'action' => 'explode'])->assertJsonValidationErrors('action');

        $editor = $this->signInAdmin(Admin::factory()->role(['products.view', 'products.edit'])->create());
        $this->bulk(['ids' => [$product->id], 'action' => 'disable'], $editor)->assertOk();
        $this->bulk(['ids' => [$product->id], 'action' => 'delete'], $editor)->assertForbidden()
            ->assertExactJson(['message' => 'Your role doesn\'t allow this.', 'code' => 'permission_denied', 'permission' => 'products.delete']);
        $this->assertNotSoftDeleted($product);

        $viewer = $this->signInAdmin(Admin::factory()->role(['products.view'])->create());
        $this->bulk(['ids' => [$product->id], 'action' => 'enable'], $viewer)->assertForbidden()->assertJsonPath('permission', 'products.edit');
    }
}
