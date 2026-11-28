<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AdminRole;
use App\Models\AuditLog;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use App\Models\Review;
use App\Services\Settings;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 5: customers write reviews; staff moderate them; ratings follow the approved ones. */
class ReviewModerationTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->product = $this->product(['rating_average' => '4.70', 'review_count' => 0]);
    }

    /** A signed-in customer's Authorization header. */
    private function customer(array $attributes = []): array
    {
        $customer = Customer::factory()->create(['first_name' => 'Nadia', 'last_name' => 'Rahman', ...$attributes]);
        $this->app['auth']->forgetGuards();
        $token = $this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])->assertOk()->json('data.tokens.access_token');

        return ['Authorization' => "Bearer {$token}", 'customer_id' => $customer->id];
    }

    private function write(array $headers, array $body = [], ?int $productId = null)
    {
        $this->app['auth']->forgetGuards();
        unset($headers['customer_id']);

        return $this->postJson('/api/v1/products/'.($productId ?? $this->product->id).'/reviews',
            ['rating' => 4, 'title' => 'Nice', 'comment' => 'Works well for me.', ...$body], $headers);
    }

    public function test_a_customer_review_waits_for_approval(): void
    {
        $customer = $this->customer();

        $response = $this->write($customer, ['title' => '<b>Great</b> mug', 'comment' => '<script>alert(1)</script>Really <i>solid</i> mug.'])->assertCreated();
        $response->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.title', 'Great mug')
            ->assertJsonPath('data.comment', 'alert(1)Really solid mug.')
            ->assertJsonPath('data.author_name', 'Nadia R.')
            ->assertJsonPath('data.verified_purchase', false);
        $this->assertSame(['id', 'rating', 'title', 'comment', 'created_at', 'author_name', 'verified_purchase', 'photos', 'status'], array_keys($response->json('data'))); // phase 22: photos

        // Not public yet, and the rating hasn't moved.
        $this->getJson("/api/v1/products/{$this->product->id}")->assertJsonPath('data.reviews', [])->assertJsonPath('data.review_count', 0)
            ->assertJsonPath('data.rating_average', '4.70');

        $this->write($customer)->assertUnprocessable()->assertJsonPath('code', 'already_reviewed')->assertJsonValidationErrors('product');
        $this->assertSame(1, Review::count());
    }

    public function test_validation_html_counts_after_stripping(): void
    {
        $customer = $this->customer();
        $this->write($customer, ['rating' => 6])->assertJsonValidationErrors('rating');
        $this->write($customer, ['comment' => '<p><b>short</b></p>'])->assertJsonValidationErrors(['comment' => 'at least 10']);
        $this->write($customer, ['comment' => str_repeat('a', 2001)])->assertJsonValidationErrors('comment');
        $this->write($customer, ['title' => str_repeat('a', 121)])->assertJsonValidationErrors('title');
        $this->write($customer, [], 999999)->assertNotFound();
        $this->write($customer, [], $this->product(['status' => 'draft'])->id)->assertNotFound();

        // Guests can't write reviews.
        $this->app['auth']->forgetGuards();
        $this->postJson("/api/v1/products/{$this->product->id}/reviews", ['rating' => 5, 'comment' => 'Lovely product indeed.'])->assertUnauthorized();
        $this->assertSame(0, Review::count());
    }

    public function test_verified_purchase_needs_a_non_cancelled_order(): void
    {
        $buyer = $this->customer(['email' => 'buyer@example.com']);
        $this->placeOrder([['product_id' => $this->product->id, 'quantity' => 1]], [], ['Authorization' => $buyer['Authorization']])->assertCreated();
        $this->write($buyer)->assertCreated()->assertJsonPath('data.verified_purchase', true);

        $canceller = $this->customer(['email' => 'cancel@example.com']);
        $this->placeOrder([['product_id' => $this->product->id, 'quantity' => 1]], [], ['Authorization' => $canceller['Authorization']])->assertCreated();
        Order::where('customer_id', $canceller['customer_id'])->update(['status' => 'cancelled']);
        $this->write($canceller)->assertCreated()->assertJsonPath('data.verified_purchase', false);
    }

    public function test_without_required_approval_reviews_are_public_at_once(): void
    {
        app(Settings::class)->put(['reviews_require_approval' => false]);
        Review::factory()->create(['product_id' => $this->product->id, 'rating' => 2]);

        $this->write($this->customer(), ['rating' => 5])->assertCreated()->assertJsonPath('data.status', 'approved');

        $this->getJson("/api/v1/products/{$this->product->id}")->assertJsonCount(2, 'data.reviews')
            ->assertJsonPath('data.review_count', 2)
            ->assertJsonPath('data.rating_average', '3.50');
    }

    public function test_the_setting_lives_in_the_catalog_group(): void
    {
        $admin = $this->adminHeaders();
        $this->asAdmin($admin, 'GET', '/api/admin/v1/settings')->assertJsonPath('data.catalog.reviews_require_approval', true);
        $this->asAdmin($admin, 'PATCH', '/api/admin/v1/settings', ['catalog' => ['reviews_require_approval' => 'maybe']])
            ->assertJsonValidationErrors('catalog.reviews_require_approval');
        $this->asAdmin($admin, 'PATCH', '/api/admin/v1/settings', ['catalog' => ['reviews_require_approval' => false]])->assertOk()
            ->assertJsonPath('data.catalog.reviews_require_approval', false);
        $this->assertSame(1, AuditLog::where('action', 'settings.updated')->count());
    }

    public function test_moderation_recomputes_the_rating_and_is_audited(): void
    {
        $admin = $this->adminHeaders();
        $five = Review::factory()->pending()->create(['product_id' => $this->product->id, 'rating' => 5]);
        $two = Review::factory()->pending()->create(['product_id' => $this->product->id, 'rating' => 2]);

        $this->asAdmin($admin, 'PATCH', "/api/admin/v1/reviews/{$five->id}", ['status' => 'approved'])->assertOk()->assertJsonPath('data.status', 'approved');
        $this->assertSame(['5.00', 1], [$this->product->fresh()->rating_average, $this->product->fresh()->review_count]);

        $this->asAdmin($admin, 'POST', '/api/admin/v1/reviews/bulk', ['ids' => [$five->id, $two->id], 'status' => 'approved'])->assertOk()
            ->assertExactJson(['data' => ['updated' => 1]]); // five was approved already
        $this->assertSame(['3.50', 2], [$this->product->fresh()->rating_average, $this->product->fresh()->review_count]);

        $this->asAdmin($admin, 'PATCH', "/api/admin/v1/reviews/{$five->id}", ['status' => 'rejected'])->assertOk();
        $this->assertSame(['2.00', 1], [$this->product->fresh()->rating_average, $this->product->fresh()->review_count]);
        $this->getJson("/api/v1/products/{$this->product->id}")->assertJsonCount(1, 'data.reviews')->assertJsonPath('data.reviews.0.id', $two->id);

        $this->asAdmin($admin, 'DELETE', "/api/admin/v1/reviews/{$two->id}")->assertNoContent();
        $this->assertSame(['0.00', 0], [$this->product->fresh()->rating_average, $this->product->fresh()->review_count]);

        $this->assertSame(['review.approved', 'review.approved', 'review.rejected', 'review.deleted'],
            AuditLog::where('action', 'like', 'review.%')->orderBy('id')->pluck('action')->all());

        // All or nothing: one unknown id refuses the batch.
        $this->asAdmin($admin, 'POST', '/api/admin/v1/reviews/bulk', ['ids' => [$five->id, 999999], 'status' => 'approved'])->assertJsonValidationErrors('ids');
        $this->assertSame('rejected', $five->fresh()->status);
        $this->asAdmin($admin, 'PATCH', "/api/admin/v1/reviews/{$five->id}", ['status' => 'spam'])->assertJsonValidationErrors('status');
    }

    public function test_the_admin_list_filters(): void
    {
        $admin = $this->adminHeaders();
        $other = $this->product(['name' => 'Kettle Deluxe']);
        $customer = Customer::factory()->create(['first_name' => 'Ben', 'last_name' => 'Shopper']);
        Review::factory()->pending()->create(['product_id' => $this->product->id, 'rating' => 1, 'comment' => 'Broke in a week.', 'customer_id' => $customer->id]);
        Review::factory()->create(['product_id' => $this->product->id, 'rating' => 5, 'comment' => 'Perfect.']);
        Review::factory()->create(['product_id' => $other->id, 'rating' => 5, 'comment' => 'Boils fast.']);

        $page = $this->asAdmin($admin, 'GET', '/api/admin/v1/reviews')->assertOk()->assertJsonPath('meta.total', 3)
            ->assertJsonPath('meta.counts', ['pending' => 1, 'approved' => 2, 'rejected' => 0]);
        $this->assertSame(['id', 'status', 'rating', 'title', 'comment', 'author_name', 'verified_purchase', 'product', 'customer', 'created_at', 'updated_at', 'photos'], // phase 22: photos
            array_keys($page->json('data.0')));

        $this->asAdmin($admin, 'GET', '/api/admin/v1/reviews?status=pending')->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.customer', ['id' => $customer->id, 'name' => 'Ben Shopper', 'email' => $customer->email]);
        $this->asAdmin($admin, 'GET', "/api/admin/v1/reviews?product_id={$other->id}")->assertJsonPath('meta.total', 1);
        $this->asAdmin($admin, 'GET', '/api/admin/v1/reviews?rating=5')->assertJsonPath('meta.total', 2);
        $this->asAdmin($admin, 'GET', '/api/admin/v1/reviews?search=kettle')->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.product.name', 'Kettle Deluxe');
        $this->asAdmin($admin, 'GET', '/api/admin/v1/reviews?status=spam')->assertJsonValidationErrors('status');
    }

    public function test_review_permissions(): void
    {
        $review = Review::factory()->pending()->create(['product_id' => $this->product->id]);

        $viewer = $this->signInAdmin(Admin::factory()->role('Viewer')->create());
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/reviews')->assertOk();
        $this->asAdmin($viewer, 'PATCH', "/api/admin/v1/reviews/{$review->id}", ['status' => 'approved'])->assertForbidden()
            ->assertJsonPath('permission', 'reviews.moderate');
        $this->asAdmin($viewer, 'POST', '/api/admin/v1/reviews/bulk', ['ids' => [$review->id], 'status' => 'approved'])->assertForbidden();
        $this->asAdmin($viewer, 'DELETE', "/api/admin/v1/reviews/{$review->id}")->assertForbidden();

        $sales = $this->signInAdmin(Admin::factory()->role('Sales staff')->create());
        $this->asAdmin($sales, 'GET', '/api/admin/v1/reviews')->assertForbidden()->assertJsonPath('permission', 'reviews.view');

        $manager = $this->signInAdmin(Admin::factory()->role('Catalog manager')->create());
        $this->asAdmin($manager, 'PATCH', "/api/admin/v1/reviews/{$review->id}", ['status' => 'approved'])->assertOk();
        $this->assertSame('approved', $review->fresh()->status);
    }

    public function test_reviews_are_rate_limited_per_customer(): void
    {
        $customer = $this->customer();
        $products = Product::factory()->count(11)->create();
        foreach ($products->take(10) as $product) {
            $this->write($customer, [], $product->id)->assertCreated();
        }
        $this->write($customer, [], $products[10]->id)->assertTooManyRequests();
    }

    public function test_starter_roles_have_the_new_keys_and_existing_roles_are_upgraded(): void
    {
        $this->assertContains('products.import', Permissions::all());
        $manager = AdminRole::where('name', 'Catalog manager')->sole();
        $viewer = AdminRole::where('name', 'Viewer')->sole();
        foreach (['products.import', 'reviews.view', 'reviews.moderate'] as $key) {
            $this->assertContains($key, $manager->permissionKeys());
        }
        $this->assertContains('reviews.view', $viewer->permissionKeys());
        $this->assertNotContains('reviews.moderate', $viewer->permissionKeys());

        // A database from before phase 5: the migration adds the keys to the existing starter roles.
        $manager->update(['permissions' => ['products.view', 'products.edit', 'products.delete', 'categories.edit']]);
        $viewer->update(['permissions' => ['dashboard.view', 'products.view']]);
        (require database_path('migrations/2026_11_16_000400_grant_phase5_permissions.php'))->up();

        $this->assertSame(['products.view', 'products.edit', 'products.delete', 'categories.edit', 'products.import', 'reviews.view', 'reviews.moderate'],
            $manager->fresh()->permissionKeys());
        $this->assertSame(['dashboard.view', 'products.view', 'reviews.view'], $viewer->fresh()->permissionKeys());
    }
}
