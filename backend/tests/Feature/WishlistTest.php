<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Category;
use App\Models\Customer;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\WishlistItem;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 11: the wishlist kept on the server, sharing it, the admin tab, and the report. */
class WishlistTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private Customer $customer;

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->customer = Customer::factory()->create(['first_name' => 'Nadia', 'last_name' => 'Rahman']);
        $this->headers = $this->customerHeaders($this->customer);
    }

    private function customerHeaders(Customer $customer): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])
            ->assertOk()->json('data.tokens.access_token')];
    }

    private function as(?array $headers, string $method, string $uri, array $body = []): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->json($method, $uri, $body, $headers ?? []);
    }

    private function me(string $method, string $uri, array $body = []): TestResponse
    {
        return $this->as($this->headers, $method, $uri, $body);
    }

    public function test_customers_add_list_update_and_remove_items_without_duplicates(): void
    {
        $lamp = $this->product(['name' => 'Desk Lamp', 'price' => '20.00']);

        $id = $this->me('POST', '/api/v1/me/wishlist', ['product_id' => $lamp->id, 'note' => ' For the office '])->assertCreated()
            ->assertJsonPath('data.product.id', $lamp->id)->assertJsonPath('data.product.sale_price', '20.00')
            ->assertJsonPath('data.variant', null)->assertJsonPath('data.note', 'For the office')->json('data.id');
        $this->assertNotNull($this->me('GET', '/api/v1/me/wishlist')->json('data.0.added_at'));

        // The same product again: 200 with the same row, no duplicate.
        $this->me('POST', '/api/v1/me/wishlist', ['product_id' => $lamp->id])->assertOk()->assertJsonPath('data.id', $id)
            ->assertJsonPath('data.note', 'For the office');
        $this->assertSame(1, WishlistItem::count());

        $this->me('GET', '/api/v1/me/wishlist')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('meta', ['shared' => false, 'shared_at' => null, 'count' => 1, 'limit' => 100]);

        $this->me('PATCH', "/api/v1/me/wishlist/{$id}", ['note' => 'Birthday'])->assertOk()->assertJsonPath('data.note', 'Birthday');
        $this->me('PATCH', "/api/v1/me/wishlist/{$id}", ['note' => str_repeat('x', 256)])->assertStatus(422)->assertJsonValidationErrors('note');

        // Someone else can't touch it.
        $other = $this->customerHeaders(Customer::factory()->create());
        $this->as($other, 'PATCH', "/api/v1/me/wishlist/{$id}", ['note' => 'Mine'])->assertNotFound();
        $this->as($other, 'DELETE', "/api/v1/me/wishlist/{$id}")->assertNotFound();
        $this->as($other, 'GET', '/api/v1/me/wishlist')->assertOk()->assertJsonCount(0, 'data');

        $this->me('DELETE', "/api/v1/me/wishlist/{$id}")->assertNoContent();
        $this->assertSame(0, WishlistItem::count());
        $this->as(null, 'GET', '/api/v1/me/wishlist')->assertUnauthorized();
    }

    public function test_variants_hidden_products_and_the_limit(): void
    {
        $shirt = $this->product(['name' => 'Tee']);
        $admin = $this->adminHeaders();
        $this->asAdmin($admin, 'PUT', "/api/admin/v1/products/{$shirt->id}/options", ['options' => [['name' => 'Size', 'values' => ['S', 'M']]]])->assertOk();
        $this->asAdmin($admin, 'POST', "/api/admin/v1/products/{$shirt->id}/variants/generate")->assertSuccessful();
        $variant = ProductVariant::where('product_id', $shirt->id)->orderBy('id')->firstOrFail();
        $variant->update(['is_active' => true, 'stock_quantity' => 5]);
        $other = $this->product();

        $this->me('POST', '/api/v1/me/wishlist', ['product_id' => $shirt->id, 'variant_id' => $variant->id])->assertCreated()
            ->assertJsonPath('data.variant.id', $variant->id)->assertJsonPath('data.variant.label', 'Size: S');
        // The product without a variant is another row.
        $this->me('POST', '/api/v1/me/wishlist', ['product_id' => $shirt->id])->assertCreated();
        $this->me('POST', '/api/v1/me/wishlist', ['product_id' => $other->id, 'variant_id' => $variant->id])->assertStatus(422)->assertJsonValidationErrors('variant_id');
        $draft = $this->product(['status' => 'draft']);
        $this->me('POST', '/api/v1/me/wishlist', ['product_id' => $draft->id])->assertStatus(422)->assertJsonValidationErrors('product_id');
        $this->me('POST', '/api/v1/me/wishlist', ['product_id' => 999999])->assertStatus(422)->assertJsonValidationErrors('product_id');

        // A product hidden later is left out of the list but its row stays.
        $this->me('POST', '/api/v1/me/wishlist', ['product_id' => $other->id])->assertCreated();
        $other->update(['status' => 'archived']);
        $this->me('GET', '/api/v1/me/wishlist')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.count', 2);
        $this->assertSame(3, WishlistItem::count());
        $other->update(['status' => 'active']);
        $this->me('GET', '/api/v1/me/wishlist')->assertJsonCount(3, 'data');

        // Deleting a product removes its rows.
        $other->delete();
        $this->assertSame(2, WishlistItem::count());

        // 100 items at most.
        foreach (Product::factory()->count(98)->create() as $product) {
            WishlistItem::create(['customer_id' => $this->customer->id, 'product_id' => $product->id]);
        }
        $this->me('POST', '/api/v1/me/wishlist', ['product_id' => $this->product()->id])->assertStatus(422)
            ->assertJsonPath('code', 'wishlist_full')->assertJsonValidationErrors('product_id');
        // An item already on the list is still answered (not a new row).
        $this->me('POST', '/api/v1/me/wishlist', ['product_id' => $shirt->id])->assertOk();
    }

    public function test_the_guest_list_is_merged_once_with_skipped_items_reported(): void
    {
        $a = $this->product();
        $b = $this->product();
        $hidden = $this->product(['status' => 'draft']);
        $this->me('POST', '/api/v1/me/wishlist', ['product_id' => $a->id])->assertCreated();

        $response = $this->me('POST', '/api/v1/me/wishlist/merge', ['items' => [
            ['product_id' => $a->id], ['product_id' => $b->id], ['product_id' => $hidden->id], ['product_id' => 999999],
        ]])->assertOk();
        $response->assertJsonCount(2, 'data')->assertJsonPath('meta.added', 1)
            ->assertJsonPath('meta.skipped', [
                ['product_id' => $hidden->id, 'variant_id' => null, 'reason' => 'unavailable'],
                ['product_id' => 999999, 'variant_id' => null, 'reason' => 'unavailable'],
            ]);
        $this->assertSame(2, WishlistItem::count());
        $this->me('POST', '/api/v1/me/wishlist/merge', ['items' => [['product_id' => $b->id]]])->assertOk()->assertJsonPath('meta.added', 0);
        $this->assertSame(2, WishlistItem::count());
    }

    public function test_sharing_creates_regenerates_and_revokes_a_link_that_shows_no_personal_data(): void
    {
        $lamp = $this->product(['name' => 'Desk Lamp']);
        $this->me('POST', '/api/v1/me/wishlist', ['product_id' => $lamp->id, 'note' => 'Please!'])->assertCreated();

        $token = $this->me('POST', '/api/v1/me/wishlist/share')->assertCreated()->assertJsonPath('data.shared', true)->json('data.token');
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9]{32}$/', $token);
        $this->assertSame(hash('sha256', $token), $this->customer->fresh()->wishlist_share_hash);
        $this->me('GET', '/api/v1/me/wishlist')->assertJsonPath('meta.shared', true);
        // Asking again doesn't show (or change) the token.
        $this->me('POST', '/api/v1/me/wishlist/share')->assertOk()->assertJsonPath('data.token', null);

        $public = $this->as(null, 'GET', "/api/v1/wishlists/{$token}")->assertOk()
            ->assertJsonPath('data.owner_first_name', 'Nadia')->assertJsonPath('data.items.0.product.name', 'Desk Lamp')
            ->assertJsonPath('data.items.0.note', 'Please!');
        $body = $public->getContent();
        $this->assertStringNotContainsString($this->customer->email, $body);
        $this->assertStringNotContainsString('Rahman', $body);
        $this->assertArrayNotHasKey('id', $public->json('data.items.0'));
        $this->assertArrayNotHasKey('customer_id', $public->json('data'));

        $new = $this->me('POST', '/api/v1/me/wishlist/share', ['regenerate' => true])->assertCreated()->json('data.token');
        $this->assertNotSame($token, $new);
        $this->as(null, 'GET', "/api/v1/wishlists/{$token}")->assertNotFound();
        $this->as(null, 'GET', "/api/v1/wishlists/{$new}")->assertOk();

        $this->me('DELETE', '/api/v1/me/wishlist/share')->assertNoContent();
        $this->as(null, 'GET', "/api/v1/wishlists/{$new}")->assertNotFound();
        $this->me('GET', '/api/v1/me/wishlist')->assertJsonPath('meta.shared', false);
        $this->as(null, 'GET', '/api/v1/wishlists/not-a-token')->assertNotFound();
    }

    public function test_staff_see_the_wishlist_tab_and_the_most_wished_for_report(): void
    {
        $lamp = $this->product(['name' => 'Desk Lamp']);
        $mug = $this->product(['name' => 'Mug', 'stock_quantity' => 0]);
        $this->me('POST', '/api/v1/me/wishlist', ['product_id' => $lamp->id, 'note' => 'Gift'])->assertCreated();
        $this->me('POST', '/api/v1/me/wishlist', ['product_id' => $mug->id])->assertCreated();
        $second = $this->customerHeaders(Customer::factory()->create());
        $this->as($second, 'POST', '/api/v1/me/wishlist', ['product_id' => $mug->id])->assertCreated();
        $lamp->update(['status' => 'draft']);

        $viewer = $this->signInAdmin(Admin::factory()->role(['customers.view', 'reports.view'])->create());
        $this->asAdmin($viewer, 'GET', "/api/admin/v1/customers/{$this->customer->id}/wishlist")->assertOk()->assertJsonCount(2, 'data')
            ->assertJsonPath('data.1.product.name', 'Desk Lamp')->assertJsonPath('data.1.product.status', 'draft')
            ->assertJsonPath('data.1.note', 'Gift')->assertJsonPath('meta.shared', false);
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/reports/wishlist')->assertOk()
            ->assertJsonPath('data.0.product_id', $mug->id)->assertJsonPath('data.0.customers', 2)->assertJsonPath('data.0.in_stock', false)
            ->assertJsonPath('data.1.product_id', $lamp->id)->assertJsonPath('data.1.customers', 1);
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/reports/wishlist?from=2020-01-01&to=2020-01-31')->assertOk()->assertJsonCount(0, 'data');

        $noCustomers = $this->signInAdmin(Admin::factory()->role(['reports.view'])->create());
        $this->asAdmin($noCustomers, 'GET', "/api/admin/v1/customers/{$this->customer->id}/wishlist")->assertForbidden();
    }

    public function test_the_data_export_and_account_deletion_include_the_wishlist(): void
    {
        $lamp = $this->product(['name' => 'Desk Lamp']);
        $this->me('POST', '/api/v1/me/wishlist', ['product_id' => $lamp->id, 'note' => 'Gift'])->assertCreated();

        $this->me('GET', '/api/v1/me/export')->assertOk()->assertJsonPath('wishlist.0.product', 'Desk Lamp')
            ->assertJsonPath('wishlist.0.note', 'Gift')->assertJsonPath('reward_transactions', [])->assertJsonPath('profile.reward_points', 0);

        $this->me('POST', '/api/v1/me/delete', ['password' => 'Password123', 'confirm' => 'DELETE'])->assertOk();
        $this->assertSame(0, WishlistItem::count());
        $this->assertNotNull(Category::find($lamp->category_id));
    }
}
