<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Review;
use App\Models\ReviewPhoto;
use App\Models\RewardTransaction;
use App\Services\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\Support\TestImages;
use Tests\TestCase;

/** Phase 23: My account → My reviews (own reviews in every status, delete a photo or the review; others' are 404). */
class MyReviewsTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private Product $product;

    private array $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Storage::fake('local');
        $this->product = $this->product(['sku' => 'MUG-01', 'name' => 'Clay mug']);
        $this->admin = $this->adminHeaders();
    }

    /** A signed-in customer's Authorization header (and their id). */
    private function customer(array $attributes = []): array
    {
        $customer = Customer::factory()->create(['first_name' => 'Nadia', 'last_name' => 'Rahman', ...$attributes]);

        return $this->signIn($customer);
    }

    private function signIn(Customer $customer): array
    {
        $this->app['auth']->forgetGuards();
        $token = $this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])->assertOk()->json('data.tokens.access_token');

        return ['Authorization' => "Bearer {$token}", 'customer_id' => $customer->id];
    }

    /** A request as this customer (forgets the previous request's account first). */
    private function as(array $customer, string $method, string $uri, array $body = [], array $headers = []): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->json($method, $uri, $body, ['Authorization' => $customer['Authorization'], ...$headers]);
    }

    private function getAs(array $customer, string $uri): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->get($uri, ['Authorization' => $customer['Authorization']]);
    }

    /** A review with two PNG photos written through the API (pending: photos always wait for staff). */
    private function reviewWithPhotos(array $customer, ?int $productId = null): Review
    {
        app(Settings::class)->put(['review_photos_enabled' => true]);
        $this->app['auth']->forgetGuards();
        $id = $this->post('/api/v1/products/'.($productId ?? $this->product->id).'/reviews', [
            'rating' => 4, 'title' => 'Nice', 'comment' => 'Works well for me.',
            'photos' => [UploadedFile::fake()->createWithContent('a.png', TestImages::png()), UploadedFile::fake()->createWithContent('b.png', TestImages::png(30, 40))],
        ], ['Authorization' => $customer['Authorization'], 'Accept' => 'application/json'])->assertCreated()->json('data.id');

        return Review::with('photos')->findOrFail($id);
    }

    private function review(array $customer, array $attributes = []): Review
    {
        return Review::factory()->create(['product_id' => $this->product->id, 'customer_id' => $customer['customer_id'], 'author_name' => 'Nadia R.', ...$attributes]);
    }

    private static function directives(TestResponse $response): array
    {
        $directives = array_map('trim', explode(',', (string) $response->headers->get('Cache-Control')));
        sort($directives);

        return $directives;
    }

    public function test_the_list_shows_only_my_reviews_in_every_status_newest_first(): void
    {
        $me = $this->customer();
        $other = $this->customer();
        $older = $this->review($me, ['status' => 'approved', 'rating' => 5, 'title' => 'Great', 'comment' => 'A really great mug.', 'created_at' => now()->subDays(3), 'verified_purchase' => true]);
        $rejected = $this->review($me, ['status' => 'rejected', 'product_id' => $this->product()->id, 'created_at' => now()->subDays(2)]);
        $pending = $this->review($me, ['status' => 'pending', 'product_id' => $this->product()->id, 'created_at' => now()->subDay()]);
        $this->review($other, ['status' => 'approved']);
        Review::factory()->create(['product_id' => $this->product->id]); // imported, nobody's

        $response = $this->as($me, 'GET', '/api/v1/me/reviews')->assertOk()
            ->assertJsonStructure(['data', 'links' => ['first', 'last', 'prev', 'next'], 'meta' => ['current_page', 'last_page', 'per_page', 'total']])
            ->assertJsonPath('meta.total', 3)->assertJsonPath('meta.per_page', 10);
        $this->assertSame([$pending->id, $rejected->id, $older->id], array_column($response->json('data'), 'id'));
        $this->assertSame(['pending', 'rejected', 'approved'], array_column($response->json('data'), 'status'));
        $this->assertSame([
            'id' => $older->id,
            'status' => 'approved',
            'rating' => 5,
            'title' => 'Great',
            'comment' => 'A really great mug.',
            'created_at' => $older->created_at->toIso8601ZuluString(),
            'verified_purchase' => true,
            'product' => ['id' => $this->product->id, 'name' => 'Clay mug', 'thumbnail_url' => $this->product->thumbnail_url, 'available' => true],
            'photos' => [],
        ], $response->json('data.2'));

        // Someone else sees only their own.
        $this->as($other, 'GET', '/api/v1/me/reviews')->assertOk()->assertJsonPath('meta.total', 1);
    }

    public function test_pagination_and_the_product_filter(): void
    {
        $me = $this->customer();
        foreach (range(1, 12) as $i) {
            $this->review($me, ['product_id' => $this->product()->id, 'created_at' => now()->subMinutes(100 - $i)]);
        }
        $mine = $this->review($me, ['created_at' => now()->subDays(5)]);

        $this->as($me, 'GET', '/api/v1/me/reviews')->assertOk()->assertJsonCount(10, 'data')
            ->assertJsonPath('meta.total', 13)->assertJsonPath('meta.last_page', 2);
        $this->as($me, 'GET', '/api/v1/me/reviews?page=2')->assertOk()->assertJsonCount(3, 'data')->assertJsonPath('data.2.id', $mine->id);
        $this->as($me, 'GET', '/api/v1/me/reviews?per_page=50')->assertOk()->assertJsonCount(13, 'data');
        $this->as($me, 'GET', '/api/v1/me/reviews?per_page=51')->assertUnprocessable()->assertJsonValidationErrors('per_page');
        $this->as($me, 'GET', '/api/v1/me/reviews?product_id=abc')->assertUnprocessable()->assertJsonValidationErrors('product_id');

        $this->as($me, 'GET', "/api/v1/me/reviews?product_id={$this->product->id}")->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $mine->id);
        $this->as($me, 'GET', '/api/v1/me/reviews?product_id=999999')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_a_product_that_is_deleted_or_not_for_sale_is_not_available(): void
    {
        $me = $this->customer();
        $deleted = $this->product(['name' => 'Old lamp']);
        $draft = $this->product(['name' => 'Draft tray']);
        $this->review($me, ['product_id' => $deleted->id, 'created_at' => now()->subMinutes(2)]);
        $this->review($me, ['product_id' => $draft->id, 'created_at' => now()->subMinute()]);
        $this->review($me);
        $deleted->delete();
        $draft->update(['status' => 'draft']);

        $data = $this->as($me, 'GET', '/api/v1/me/reviews')->assertOk()->json('data');
        $this->assertSame([[$this->product->id, true], [$draft->id, false], [$deleted->id, false]],
            array_map(fn ($item) => [$item['product']['id'], $item['product']['available']], $data));
        $this->assertSame('Old lamp', $data[2]['product']['name']);
    }

    public function test_the_product_name_follows_the_request_language(): void
    {
        $me = $this->customer();
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$this->product->id}", ['translations' => ['bn' => ['name' => 'মাটির মগ']]])->assertOk();
        $this->review($me);

        $this->as($me, 'GET', '/api/v1/me/reviews', [], ['Accept-Language' => 'bn'])->assertOk()->assertJsonPath('data.0.product.name', 'মাটির মগ');
        $this->as($me, 'GET', '/api/v1/me/reviews', [], ['Accept-Language' => 'en'])->assertOk()->assertJsonPath('data.0.product.name', 'Clay mug');
    }

    public function test_photo_urls_have_the_storefront_shape_and_hidden_photos_are_listed(): void
    {
        $me = $this->customer();
        $review = $this->reviewWithPhotos($me);
        [$first, $second] = $review->photos;
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}/photos/{$second->id}", ['hidden' => true])->assertOk();

        $this->as($me, 'GET', '/api/v1/me/reviews')->assertOk()
            ->assertJsonPath('data.0.status', 'pending')
            ->assertJsonPath('data.0.photos', [
                ['id' => $first->id, 'url' => "/api/shop/me/reviews/{$review->id}/photos/{$first->id}", 'width' => 40, 'height' => 30, 'hidden' => false, 'position' => 0],
                ['id' => $second->id, 'url' => "/api/shop/me/reviews/{$review->id}/photos/{$second->id}", 'width' => 30, 'height' => 40, 'hidden' => true, 'position' => 1],
            ]);
    }

    public function test_the_author_gets_their_own_photo_bytes_in_every_status_and_nobody_else_does(): void
    {
        $me = $this->customer();
        $review = $this->reviewWithPhotos($me);
        $photo = $review->photos[0];
        $uri = "/api/v1/me/reviews/{$review->id}/photos/{$photo->id}";

        $response = $this->getAs($me, $uri)->assertOk()
            ->assertHeader('Content-Type', 'image/png')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        $this->assertSame(['no-store', 'private'], self::directives($response));
        $this->assertSame(Storage::disk('local')->get($photo->path), $response->getContent());

        // Hidden by staff, then rejected: still the author's.
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}/photos/{$photo->id}", ['hidden' => true])->assertOk();
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}", ['status' => 'rejected'])->assertOk();
        $this->getAs($me, $uri)->assertOk();

        // Another customer, a photo of another review, a missing photo, no sign-in: the same 404 / 401.
        $other = $this->customer();
        $this->as($other, 'GET', $uri)->assertNotFound()->assertJsonPath('message', 'Photo not found.');
        $otherReview = $this->reviewWithPhotos($other, $this->product()->id);
        $this->as($me, 'GET', "/api/v1/me/reviews/{$review->id}/photos/{$otherReview->photos[0]->id}")->assertNotFound();
        $this->as($me, 'GET', "/api/v1/me/reviews/{$otherReview->id}/photos/{$otherReview->photos[0]->id}")->assertNotFound();
        $this->as($me, 'GET', "/api/v1/me/reviews/{$review->id}/photos/999999")->assertNotFound();
        $this->app['auth']->forgetGuards();
        $this->getJson($uri)->assertUnauthorized();
    }

    public function test_deleting_an_approved_review_refreshes_the_product_and_is_audited(): void
    {
        $customer = Customer::factory()->create(['email' => 'nadia@example.com']);
        $me = $this->signIn($customer);
        $review = $this->reviewWithPhotos($me);
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}", ['status' => 'approved'])->assertOk();
        $this->assertSame(1, $this->product->fresh()->review_count);
        $paths = $review->photos->pluck('path')->all();
        $name = $review->photos[0]->name;
        $this->getJson("/api/v1/review-photos/{$name}")->assertOk();

        // Somebody else can't.
        $other = $this->customer();
        $this->as($other, 'DELETE', "/api/v1/me/reviews/{$review->id}")->assertNotFound()->assertJsonPath('message', 'Review not found.');
        $this->assertNotNull($review->fresh());

        $this->as($me, 'DELETE', "/api/v1/me/reviews/{$review->id}")->assertNoContent();

        $this->assertNull($review->fresh());
        $this->assertSame(0, ReviewPhoto::count());
        foreach ($paths as $path) {
            Storage::disk('local')->assertMissing($path);
        }
        Storage::disk('local')->assertMissing("review-photos/{$review->id}");
        $this->getJson("/api/v1/review-photos/{$name}")->assertNotFound();
        $product = $this->product->fresh();
        $this->assertSame(0, $product->review_count);
        $this->getJson("/api/v1/products/{$this->product->id}")->assertJsonPath('data.reviews', [])->assertJsonPath('data.review_count', 0);

        $entry = AuditLog::where('action', 'review.deleted_by_customer')->sole();
        $this->assertNull($entry->admin_id);
        $this->assertSame("Review #{$review->id} on product MUG-01 deleted by its author.", $entry->summary);
        $this->assertSame(['review', $review->id], [$entry->subject_type, $entry->subject_id]);
        $this->assertSame('nadia@example.com', $entry->changes['before']['customer_email']);
        $this->assertSame('approved', $entry->changes['before']['status']);
        $this->assertSame(0, AuditLog::where('action', 'review.deleted')->count());

        // Gone for good: a second delete is a 404.
        $this->as($me, 'DELETE', "/api/v1/me/reviews/{$review->id}")->assertNotFound();
    }

    public function test_writing_again_after_a_delete_works_without_a_second_review_bonus(): void
    {
        $this->asAdmin($this->admin, 'PATCH', '/api/admin/v1/settings', ['rewards' => ['enabled' => true, 'review_bonus' => 20]])->assertOk();
        $customer = Customer::factory()->create();
        $me = $this->signIn($customer);

        $first = $this->as($me, 'POST', "/api/v1/products/{$this->product->id}/reviews", ['rating' => 5, 'comment' => 'Lovely mug, thank you.'])->assertCreated()->json('data.id');
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$first}", ['status' => 'approved'])->assertOk();
        $this->assertSame(20, $customer->fresh()->reward_points);

        $this->as($me, 'DELETE', "/api/v1/me/reviews/{$first}")->assertNoContent();
        $this->assertSame(20, $customer->fresh()->reward_points); // points already earned stay
        $this->assertSame(1, RewardTransaction::where('customer_id', $customer->id)->where('type', 'review')->count());

        $second = $this->as($me, 'POST', "/api/v1/products/{$this->product->id}/reviews", ['rating' => 4, 'comment' => 'Still a lovely mug.'])->assertCreated()->json('data.id');
        $this->as($me, 'GET', "/api/v1/me/reviews?product_id={$this->product->id}")->assertJsonPath('data.0.id', $second)->assertJsonPath('data.0.status', 'pending');
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$second}", ['status' => 'approved'])->assertOk();
        $this->assertSame(20, $customer->fresh()->reward_points);
        $this->assertSame(1, RewardTransaction::where('customer_id', $customer->id)->where('type', 'review')->count());
        $this->assertSame(1, $this->product->fresh()->review_count);
    }

    public function test_deleting_a_pending_review_leaves_the_product_stats_alone(): void
    {
        $me = $this->customer();
        $this->review($this->customer(), ['rating' => 4]);
        $this->product->refreshReviewStats();
        $pending = $this->review($me, ['status' => 'pending', 'rating' => 1]);

        $this->as($me, 'DELETE', "/api/v1/me/reviews/{$pending->id}")->assertNoContent();
        $product = $this->product->fresh();
        $this->assertSame(1, $product->review_count);
        $this->assertEquals(4, $product->rating_average);
    }

    public function test_deleting_a_photo_renumbers_the_rest_and_keeps_the_status(): void
    {
        $customer = Customer::factory()->create(['email' => 'nadia@example.com']);
        $me = $this->signIn($customer);
        app(Settings::class)->put(['review_photos_enabled' => true]);
        $this->app['auth']->forgetGuards();
        $id = $this->post("/api/v1/products/{$this->product->id}/reviews", [
            'rating' => 4, 'comment' => 'Works well for me.',
            'photos' => [
                UploadedFile::fake()->createWithContent('a.png', TestImages::png()),
                UploadedFile::fake()->createWithContent('b.png', TestImages::png(30, 40)),
                UploadedFile::fake()->createWithContent('c.webp', TestImages::webp()),
            ],
        ], ['Authorization' => $me['Authorization'], 'Accept' => 'application/json'])->assertCreated()->json('data.id');
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$id}", ['status' => 'approved'])->assertOk();
        $review = Review::with('photos')->findOrFail($id);
        [$first, $second, $third] = $review->photos;

        // Somebody else can't.
        $other = $this->customer();
        $this->as($other, 'DELETE', "/api/v1/me/reviews/{$id}/photos/{$first->id}")->assertNotFound()->assertJsonPath('message', 'Photo not found.');
        $this->as($me, 'DELETE', "/api/v1/me/reviews/{$id}/photos/999999")->assertNotFound();
        $this->assertSame(3, ReviewPhoto::count());

        $this->as($me, 'DELETE', "/api/v1/me/reviews/{$id}/photos/{$first->id}")->assertOk()
            ->assertJsonPath('data.id', $id)
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.photos.0.id', $second->id)->assertJsonPath('data.photos.0.position', 0)
            ->assertJsonPath('data.photos.0.url', "/api/shop/me/reviews/{$id}/photos/{$second->id}")
            ->assertJsonPath('data.photos.1.id', $third->id)->assertJsonPath('data.photos.1.position', 1)
            ->assertJsonCount(2, 'data.photos');

        $this->assertSame('approved', $review->fresh()->status);
        $this->assertNull(ReviewPhoto::find($first->id));
        $this->assertSame([0, 1], $review->photos()->pluck('position')->all());
        Storage::disk('local')->assertMissing($first->path);
        Storage::disk('local')->assertExists($second->path);
        $this->getJson("/api/v1/review-photos/{$first->name}")->assertNotFound();
        $this->getJson("/api/v1/review-photos/{$second->name}")->assertOk();
        $this->getAs($me, "/api/v1/me/reviews/{$id}/photos/{$first->id}")->assertNotFound();

        $entry = AuditLog::where('action', 'review.photo_deleted_by_customer')->sole();
        $this->assertNull($entry->admin_id);
        $this->assertSame("Photo 1 of review #{$id} on product MUG-01 deleted by its author.", $entry->summary);
        $this->assertSame('nadia@example.com', $entry->changes['before']['customer_email']);
        $this->assertSame($first->id, $entry->changes['before']['photo_id']);

        // The last photos go too; the folder with them.
        $this->as($me, 'DELETE', "/api/v1/me/reviews/{$id}/photos/{$third->id}")->assertOk()->assertJsonCount(1, 'data.photos');
        $this->as($me, 'DELETE', "/api/v1/me/reviews/{$id}/photos/{$second->id}")->assertOk()->assertJsonPath('data.photos', []);
        Storage::disk('local')->assertMissing("review-photos/{$id}");
        $this->assertSame('approved', $review->fresh()->status);
    }

    public function test_the_export_lists_review_photos_and_a_note(): void
    {
        $me = $this->customer();
        $review = $this->reviewWithPhotos($me);
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}/photos/{$review->photos[1]->id}", ['hidden' => true])->assertOk();

        $export = $this->as($me, 'GET', '/api/v1/me/export')->assertOk();
        $this->assertSame('Your review photos can be seen and downloaded in My account → My reviews.', $export->json('photos_note'));
        $this->assertSame([
            ['width' => 40, 'height' => 30, 'hidden' => false, 'added_at' => $review->photos[0]->created_at->toIso8601ZuluString()],
            ['width' => 30, 'height' => 40, 'hidden' => true, 'added_at' => $review->photos[1]->created_at->toIso8601ZuluString()],
        ], $export->json('reviews.0.photos'));
        $this->assertStringNotContainsString($review->photos[0]->name, $export->getContent()); // no file names or addresses
    }

    public function test_staff_tokens_and_guests_are_refused(): void
    {
        $me = $this->customer();
        $review = $this->review($me);

        foreach ([['GET', '/api/v1/me/reviews'], ['DELETE', "/api/v1/me/reviews/{$review->id}"], ['DELETE', "/api/v1/me/reviews/{$review->id}/photos/1"],
            ['GET', "/api/v1/me/reviews/{$review->id}/photos/1"]] as [$method, $uri]) {
            $this->asAdmin($this->admin, $method, $uri)->assertForbidden();
            $this->app['auth']->forgetGuards();
            $this->json($method, $uri)->assertUnauthorized();
        }
        $this->assertNotNull($review->fresh());
    }

    public function test_deletes_count_with_writing_reviews(): void
    {
        config(['buynest.reviews_per_hour' => 2]);
        $me = $this->customer();
        $reviews = [$this->review($me), $this->review($me, ['product_id' => $this->product()->id]), $this->review($me, ['product_id' => $this->product()->id])];

        $this->as($me, 'DELETE', "/api/v1/me/reviews/{$reviews[0]->id}")->assertNoContent();
        $this->as($me, 'DELETE', "/api/v1/me/reviews/{$reviews[1]->id}")->assertNoContent();
        $this->as($me, 'DELETE', "/api/v1/me/reviews/{$reviews[2]->id}")->assertTooManyRequests();
        $this->as($me, 'GET', '/api/v1/me/reviews')->assertOk()->assertJsonPath('meta.total', 1); // reads use the normal limit
    }
}
