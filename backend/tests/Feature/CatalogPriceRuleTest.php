<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AdminRole;
use App\Models\AuditLog;
use App\Models\CatalogRule;
use App\Models\Category;
use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\Order;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Services\CatalogRules;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 7: catalog price rules (automatic sale prices). */
class CatalogPriceRuleTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    private Category $clothing;

    private Category $shoes; // under clothing

    private Category $boots; // under shoes

    private Product $boot; // 100.00, 10% own discount → 90.00

    private Product $mug;  // 20.00, other category

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
        $this->clothing = Category::factory()->create(['name' => 'Clothing']);
        $this->shoes = Category::factory()->create(['name' => 'Shoes', 'parent_id' => $this->clothing->id]);
        $this->boots = Category::factory()->create(['name' => 'Boots', 'parent_id' => $this->shoes->id]);
        $this->boot = $this->product(['price' => '100.00', 'discount_percent' => '10.00', 'category_id' => $this->boots->id]);
        $this->mug = $this->product(['price' => '20.00']);
    }

    private function rule(array $attributes = []): CatalogRule
    {
        return CatalogRule::create(['name' => 'Sale', 'action' => 'percent', 'amount' => '20.00', 'is_active' => true, ...$attributes]);
    }

    private function storePrice(Product $product): string
    {
        return $this->getJson("/api/v1/products/{$product->id}")->assertOk()->json('data.sale_price');
    }

    private function cartLine(Product $product, array $headers = [], ?int $variantId = null): array
    {
        $this->app['auth']->forgetGuards();

        return $this->postJson('/api/v1/cart/validate', [
            'items' => [['product_id' => $product->id, 'variant_id' => $variantId, 'quantity' => 1]], 'shipping_method' => 'standard',
        ], $headers)->assertOk()->json('data.lines.0');
    }

    private function customerHeaders(Customer $customer): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])
            ->assertOk()->json('data.tokens.access_token')];
    }

    public function test_best_price_wins_between_the_own_discount_and_the_rules(): void
    {
        // 5% off 100 = 95 > own 90: the own price stays, no rule label.
        $this->rule(['amount' => '5.00']);
        $this->assertSame('90.00', $this->storePrice($this->boot));
        $this->getJson("/api/v1/products/{$this->boot->id}")->assertJsonPath('data.price_rule', null)
            ->assertJsonPath('data.discount_percent', 10);

        // 20% off the base 100 = 80 < 90: the rule wins (applied to the base price, not on top of the own discount).
        $twenty = $this->rule(['name' => 'Winter sale', 'amount' => '20.00', 'priority' => 0]);
        CatalogRule::where('amount', '5.00')->update(['priority' => 5]);
        app(CatalogRules::class)->flush();
        $this->assertSame('76.00', $this->storePrice($this->boot)); // 20% then 5%: 100 → 80 → 76
        $this->getJson('/api/v1/products')->assertOk()->assertJsonPath('data.0.price_rule', ['id' => $twenty->id, 'name' => 'Winter sale']);

        // stop_further: the 5% rule after it is skipped.
        $twenty->update(['stop_further' => true]);
        $this->assertSame('80.00', $this->storePrice($this->boot));
        $line = $this->cartLine($this->boot);
        $this->assertSame(['80.00', '80.00', 'Winter sale'], [$line['base_sale_price'], $line['sale_price'], $line['price_label']]);
    }

    public function test_never_below_one_cent(): void
    {
        $this->rule(['action' => 'fixed', 'amount' => '500.00']);
        $this->assertSame('0.01', $this->storePrice($this->boot));
        $this->assertSame('0.01', $this->storePrice($this->mug));
        CatalogRule::query()->delete();
        app(CatalogRules::class)->flush();
        $this->rule(['action' => 'percent', 'amount' => '100.00']);
        $this->assertSame('0.01', $this->storePrice($this->mug));
        $this->assertSame('0.01', $this->cartLine($this->mug)['sale_price']);
    }

    public function test_categories_include_their_descendants_and_product_limits(): void
    {
        $rule = $this->rule(['category_ids' => [$this->clothing->id]]);
        $this->assertSame('80.00', $this->storePrice($this->boot)); // Boots is under Shoes under Clothing
        $this->assertSame('20.00', $this->storePrice($this->mug));

        // A category moved out of the tree no longer matches (the cache clears on category changes).
        $this->boots->update(['parent_id' => null]);
        $this->assertSame('90.00', $this->storePrice($this->boot));

        $rule->update(['category_ids' => [], 'product_ids' => [$this->mug->id]]);
        $this->assertSame(['90.00', '16.00'], [$this->storePrice($this->boot), $this->storePrice($this->mug)]);
    }

    public function test_dates_start_and_end_on_time(): void
    {
        $this->travelTo(now()->startOfMinute());
        $this->rule(['starts_at' => now()->addHour(), 'ends_at' => now()->addHours(2)]);
        $this->assertSame('20.00', $this->storePrice($this->mug)); // cached: nothing active yet

        $this->travel(61)->minutes();
        $this->assertSame('16.00', $this->storePrice($this->mug)); // the cache knew when to rebuild

        $this->travel(60)->minutes();
        $this->assertSame('20.00', $this->storePrice($this->mug));
        $this->rule(['name' => 'Off', 'is_active' => false]);
        $this->assertSame('20.00', $this->storePrice($this->mug));
        $this->artisan('buynest:refresh-price-rules')->assertSuccessful();
    }

    public function test_group_rules_apply_in_the_cart_and_checkout_only_and_combine_with_the_group_discount(): void
    {
        $vip = CustomerGroup::where('code', 'vip')->sole(); // 5% group discount
        $customer = Customer::factory()->create(['group_id' => $vip->id]);
        $this->rule(['name' => 'VIP week', 'customer_group_ids' => [$vip->id], 'amount' => '25.00']);

        // The storefront catalog shows rules for everyone only; a guest (General) doesn't get it in the cart either.
        $this->assertSame('20.00', $this->storePrice($this->mug));
        $this->assertSame('20.00', $this->cartLine($this->mug)['sale_price']);

        // VIP: 25% off 20 = 15.00, then the group's 5% = 14.25.
        $headers = $this->customerHeaders($customer);
        $line = $this->cartLine($this->mug, $headers);
        $this->assertSame(['15.00', '14.25', 'VIP price'], [$line['base_sale_price'], $line['sale_price'], $line['price_label']]);
        $this->assertSame(['id' => CatalogRule::sole()->id, 'name' => 'VIP week'], $line['price_rule']);

        $this->app['auth']->forgetGuards();
        $order = $this->placeOrder([['product_id' => $this->mug->id, 'quantity' => 2]], ['email' => $customer->email], $headers)->assertCreated();
        $order->assertJsonPath('data.items.0.sale_price', '14.25')->assertJsonPath('data.items.0.price_label', 'VIP price')
            ->assertJsonPath('data.totals.subtotal', '28.50');
        $this->assertSame('VIP price', Order::sole()->items->first()->price_label);

        // Admin-created orders price the customer's group the same way.
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/orders/quote', [
            'customer_id' => $customer->id, 'items' => [['product_id' => $this->mug->id, 'quantity' => 1]],
        ])->assertOk()->assertJsonPath('data.lines.0.sale_price', '14.25')->assertJsonPath('data.lines.0.price_label', 'VIP price');
    }

    public function test_a_group_rule_after_a_sale_for_everyone_labels_the_line_as_the_group_price(): void
    {
        $vip = CustomerGroup::where('code', 'vip')->sole(); // 5% group discount
        $customer = Customer::factory()->create(['group_id' => $vip->id]);
        $this->rule(['name' => 'Spring sale', 'amount' => '10.00', 'priority' => 0]);
        $this->rule(['name' => 'VIP week', 'customer_group_ids' => [$vip->id], 'amount' => '25.00', 'priority' => 10]);

        // Everyone: 20.00 − 10% = 18.00, named after the sale.
        $this->assertSame(['18.00', 'Spring sale'], [$this->cartLine($this->mug)['sale_price'], $this->cartLine($this->mug)['price_label']]);
        // VIP: 18.00 − 25% = 13.50 (then the group's 5% = 12.83): the group's rule took part, so it reads "VIP price".
        $line = $this->cartLine($this->mug, $this->customerHeaders($customer));
        $this->assertSame(['13.50', 'VIP price'], [$line['base_sale_price'], $line['price_label']]);

        // A sale that stops further rules keeps its own name: the group's rule never ran.
        CatalogRule::where('name', 'Spring sale')->update(['stop_further' => true]);
        app(CatalogRules::class)->flush();
        $line = $this->cartLine($this->mug, $this->customerHeaders($customer));
        $this->assertSame(['18.00', 'Spring sale'], [$line['base_sale_price'], $line['price_label']]);
    }

    public function test_rules_apply_to_variants(): void
    {
        $shirt = $this->product(['price' => '40.00', 'category_id' => $this->shoes->id]);
        $this->asAdmin($this->admin, 'PUT', "/api/admin/v1/products/{$shirt->id}/options", ['options' => [['name' => 'Size', 'values' => ['S', 'M']]]])->assertOk();
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/products/{$shirt->id}/variants/generate")->assertOk();
        [$small, $medium] = ProductVariant::orderBy('id')->get()->all();
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$shirt->id}/variants/{$small->id}", ['stock_quantity' => 5, 'is_active' => true])->assertOk();
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$shirt->id}/variants/{$medium->id}",
            ['stock_quantity' => 5, 'is_active' => true, 'price' => '60.00'])->assertOk();
        $this->rule(['category_ids' => [$this->shoes->id], 'amount' => '50.00']);

        $variants = collect($this->getJson("/api/v1/products/{$shirt->id}")->assertOk()->json('data.variants'))->keyBy('id');
        $this->assertSame(['20.00', '30.00'], [$variants[$small->id]['final_price'], $variants[$medium->id]['final_price']]);
        $this->assertSame('30.00', $this->cartLine($shirt->fresh(), [], $medium->id)['sale_price']);
    }

    public function test_staff_manage_rules_with_validation_preview_audit_and_permissions(): void
    {
        $vip = CustomerGroup::where('code', 'vip')->sole();
        $created = $this->asAdmin($this->admin, 'POST', '/api/admin/v1/catalog-rules', [
            'name' => 'Boot sale', 'action' => 'percent', 'amount' => '25', 'category_ids' => [$this->shoes->id],
            'customer_group_ids' => [$vip->id], 'starts_at' => '2026-01-01', 'priority' => 3,
        ])->assertCreated()
            ->assertJsonPath('data.amount', '25.00')->assertJsonPath('data.category_ids', [$this->shoes->id])
            ->assertJsonPath('data.product_ids', [])->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.starts_at', '2026-01-01T00:00:00Z')->assertJsonPath('data.stop_further', false);
        $id = $created->json('data.id');
        $this->assertSame(['id', 'name', 'description', 'is_active', 'status', 'starts_at', 'ends_at', 'customer_group_ids', 'category_ids',
            'product_ids', 'action', 'amount', 'priority', 'stop_further', 'created_at', 'updated_at'], array_keys($created->json('data')));

        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/catalog-rules', [
            'action' => 'percent', 'amount' => '101', 'category_ids' => [999999], 'ends_at' => '2020-01-01', 'starts_at' => '2021-01-01',
        ])->assertUnprocessable()->assertJsonValidationErrors(['name', 'category_ids.0']);
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/catalog-rules', ['name' => 'X', 'action' => 'percent', 'amount' => '101'])
            ->assertUnprocessable()->assertJsonValidationErrors('amount');
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/catalog-rules/{$id}", ['ends_at' => '2025-12-31'])
            ->assertUnprocessable()->assertJsonValidationErrors('ends_at');
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/catalog-rules/{$id}", ['is_active' => false])->assertOk()
            ->assertJsonPath('data.status', 'inactive');

        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/catalog-rules?status=inactive')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.total', 1);
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/catalog-rules/999999')->assertNotFound()
            ->assertJsonPath('message', 'Catalog price rule not found.');

        // Preview: this rule alone, even inactive: the boot (100 → own 90) becomes 75.
        $this->asAdmin($this->admin, 'GET', "/api/admin/v1/catalog-rules/{$id}/preview")->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0', [
                'product_id' => $this->boot->id, 'name' => $this->boot->name, 'sku' => $this->boot->sku, 'thumbnail_url' => $this->boot->thumbnail_url,
                'status' => 'active', 'has_variants' => false, 'price' => '100.00', 'old_price' => '90.00', 'new_price' => '75.00',
            ]);

        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/catalog-rules/{$id}")->assertNoContent();
        $this->assertSame(['catalog_rule.created', 'catalog_rule.updated', 'catalog_rule.deleted'],
            AuditLog::where('subject_type', 'catalog_rule')->orderBy('id')->pluck('action')->all());

        // Marketing manages them; Viewer reads them (coupons.view) but can't change them.
        $marketing = $this->signInAdmin(Admin::factory()->create(['role_id' => AdminRole::where('name', 'Marketing')->value('id')]));
        $this->asAdmin($marketing, 'POST', '/api/admin/v1/catalog-rules', ['name' => 'M', 'action' => 'fixed', 'amount' => '1'])->assertCreated();
        $viewer = $this->signInAdmin(Admin::factory()->create(['role_id' => AdminRole::where('name', 'Viewer')->value('id')]));
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/catalog-rules')->assertOk();
        $this->asAdmin($viewer, 'POST', '/api/admin/v1/catalog-rules', ['name' => 'V', 'action' => 'fixed', 'amount' => '1'])
            ->assertForbidden()->assertJsonPath('permission', 'price_rules.manage');
    }

    public function test_the_active_rules_are_cached_and_cleared_on_change(): void
    {
        $rule = $this->rule();
        $this->assertSame('16.00', $this->storePrice($this->mug));
        $this->assertIsArray(Cache::get(CatalogRules::CACHE_KEY));

        $rule->update(['amount' => '50.00']);
        $this->assertNull(Cache::get(CatalogRules::CACHE_KEY));
        $this->assertSame('10.00', $this->storePrice($this->mug));
        $rule->delete();
        $this->assertSame('20.00', $this->storePrice($this->mug));
    }
}
