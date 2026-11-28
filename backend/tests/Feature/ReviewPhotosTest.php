<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AuditLog;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Review;
use App\Models\ReviewPhoto;
use App\Services\ImageResizer;
use App\Services\ReviewPhotoProcessor;
use App\Services\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\Support\TestImages;
use Tests\TestCase;

/** Phase 22: product reviews with photos (private until approved, cleaned, hidden one by one by staff). */
class ReviewPhotosTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private Product $product;

    private array $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Storage::fake('local');
        Storage::fake('public');
        $this->product = $this->product(['sku' => 'MUG-01']);
        $this->admin = $this->adminHeaders();
    }

    private function enable(bool $requireApproval = true): void
    {
        app(Settings::class)->put(['review_photos_enabled' => true, 'reviews_require_approval' => $requireApproval]);
    }

    /** A signed-in customer's Authorization header (and their id). */
    private function customer(array $attributes = []): array
    {
        $customer = Customer::factory()->create(['first_name' => 'Nadia', 'last_name' => 'Rahman', ...$attributes]);
        $this->app['auth']->forgetGuards();
        $token = $this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])->assertOk()->json('data.tokens.access_token');

        return ['Authorization' => "Bearer {$token}", 'customer_id' => $customer->id];
    }

    /** A multipart review with these photos (UploadedFile list). */
    private function writeWithPhotos(array $customer, array $photos, array $body = [], ?int $productId = null): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->post('/api/v1/products/'.($productId ?? $this->product->id).'/reviews',
            ['rating' => 4, 'title' => 'Nice', 'comment' => 'Works well for me.', 'photos' => $photos, ...$body],
            ['Authorization' => $customer['Authorization'], 'Accept' => 'application/json']);
    }

    private static function upload(string $name, string $bytes): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, $bytes);
    }

    /** A review by a new customer with these photos (default: two PNGs), approved unless $approve is false. */
    private function reviewWithPhotos(?array $photos = null, bool $approve = true, array $customerAttributes = []): Review
    {
        $this->enable();
        $customer = $this->customer($customerAttributes);
        $id = $this->writeWithPhotos($customer, $photos ?? [self::upload('a.png', TestImages::png()), self::upload('b.png', TestImages::png(30, 40))])
            ->assertCreated()->json('data.id');
        if ($approve) {
            $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$id}", ['status' => 'approved'])->assertOk();
        }

        return Review::with('photos')->findOrFail($id);
    }

    private function assertNothingStored(): void
    {
        $this->assertSame(0, Review::count());
        $this->assertSame(0, ReviewPhoto::count());
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    private static function directives(TestResponse $response): array
    {
        $directives = array_map('trim', explode(',', (string) $response->headers->get('Cache-Control')));
        sort($directives);

        return $directives;
    }

    public function test_the_setting_is_off_by_default_and_photos_are_refused(): void
    {
        $this->assertFalse(app(Settings::class)->get('review_photos_enabled'));
        $this->getJson('/api/v1/store')->assertJsonPath('data.review_photos', ['enabled' => false, 'max' => 3, 'max_megabytes' => 5]);

        $customer = $this->customer();
        $this->writeWithPhotos($customer, [self::upload('a.png', TestImages::png())])->assertUnprocessable()
            ->assertExactJson([
                'message' => 'Photos can\'t be added to reviews.',
                'code' => 'photos_disabled',
                'errors' => ['photos' => ['Photos can\'t be added to reviews.']],
            ]);
        $this->assertNothingStored();

        // JSON reviews work exactly as before (photos: [] in the answer).
        $this->app['auth']->forgetGuards();
        $this->postJson("/api/v1/products/{$this->product->id}/reviews", ['rating' => 5, 'comment' => 'Lovely mug, thank you.'],
            ['Authorization' => $customer['Authorization']])->assertCreated()
            ->assertJsonPath('data.status', 'pending')->assertJsonPath('data.photos', []);
        $this->assertSame(0, ReviewPhoto::count());
    }

    public function test_the_setting_is_in_the_catalog_group_and_the_store_info(): void
    {
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/settings')->assertJsonPath('data.catalog', ['reviews_require_approval' => true, 'review_photos_enabled' => false]);
        $this->asAdmin($this->admin, 'PATCH', '/api/admin/v1/settings', ['catalog' => ['review_photos_enabled' => 'maybe']])
            ->assertJsonValidationErrors('catalog.review_photos_enabled');
        $this->asAdmin($this->admin, 'PATCH', '/api/admin/v1/settings', ['catalog' => ['review_photos_enabled' => true]])->assertOk()
            ->assertJsonPath('data.catalog.review_photos_enabled', true);
        $this->getJson('/api/v1/store')->assertJsonPath('data.review_photos', ['enabled' => true, 'max' => 3, 'max_megabytes' => 5]);
    }

    public function test_photos_are_stored_privately_and_the_review_always_waits_for_approval(): void
    {
        $this->enable(requireApproval: false);
        $customer = $this->customer();

        $response = $this->writeWithPhotos($customer, [
            self::upload('one.png', TestImages::png(40, 30)),
            self::upload('two.jpg', TestImages::jpegWithGps(50, 20)),
            self::upload('three.webp', TestImages::webp(20, 20)),
        ])->assertCreated()->assertJsonPath('data.status', 'pending')->assertJsonPath('data.author_name', 'Nadia R.');

        $photos = ReviewPhoto::orderBy('position')->get();
        $this->assertCount(3, $photos);
        $this->assertSame([0, 1, 2], $photos->pluck('position')->all());
        $this->assertSame([[40, 30], [50, 20], [20, 20]], $photos->map(fn ($p) => [$p->width, $p->height])->all());
        foreach ($photos as $i => $photo) {
            $this->assertMatchesRegularExpression(ReviewPhoto::NAME_PATTERN, $photo->name);
            $this->assertSame(['png', 'jpg', 'webp'][$i], pathinfo($photo->name, PATHINFO_EXTENSION));
            $this->assertSame("review-photos/{$photo->review_id}/{$photo->name}", $photo->path);
            Storage::disk('local')->assertExists($photo->path);
            $this->assertSame(strlen(Storage::disk('local')->get($photo->path)), $photo->size_bytes);
            $this->assertFalse($photo->hidden);
        }
        $this->assertSame([], Storage::disk('public')->allFiles()); // never on the public disk
        $this->assertSame($photos->map(fn ($p) => ['id' => $p->id, 'url' => "/media/reviews/{$p->name}", 'width' => $p->width, 'height' => $p->height])->all(),
            $response->json('data.photos'));

        // Not public, and the rating hasn't moved (a review without photos would have been approved at once).
        $this->getJson("/api/v1/products/{$this->product->id}")->assertJsonPath('data.reviews', [])->assertJsonPath('data.review_count', 0)
            ->assertJsonPath('data.review_photo_count', 0);
        $this->getJson("/api/v1/review-photos/{$photos[0]->name}")->assertNotFound();

        // A review without photos still follows the setting.
        $this->writeWithPhotos($this->customer(), [], [])->assertCreated();
        $this->app['auth']->forgetGuards();
        $this->postJson("/api/v1/products/{$this->product->id}/reviews", ['rating' => 5, 'comment' => 'Lovely mug, thank you.'],
            ['Authorization' => $this->customer()['Authorization']])->assertCreated()->assertJsonPath('data.status', 'approved');
    }

    public function test_bad_uploads_are_refused_and_nothing_is_stored(): void
    {
        $this->enable();
        $customer = $this->customer();
        $png = fn (string $name = 'a.png') => self::upload($name, TestImages::png());

        $this->writeWithPhotos($customer, [$png(), $png(), $png(), $png()])->assertUnprocessable()
            ->assertJsonPath('errors.photos', ['Add at most 3 photos.']);
        $this->assertNothingStored();

        $this->writeWithPhotos($customer, [$png(), UploadedFile::fake()->create('huge.jpg', ReviewPhoto::MAX_KILOBYTES + 1, 'image/jpeg')])->assertUnprocessable()
            ->assertJsonPath('errors', ['photos.1' => ['Each photo can be at most 5 MB.']]);
        $this->assertNothingStored();

        $this->writeWithPhotos($customer, [$png(), self::upload('notes.jpg', 'Just some text, not a photo at all.')])->assertUnprocessable()
            ->assertJsonPath('errors', ['photos.1' => ['Only JPEG, PNG or WebP photos can be added.']]);
        $this->assertNothingStored();

        $svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>';
        $this->writeWithPhotos($customer, [self::upload('cat.png', $svg)])->assertUnprocessable()
            ->assertJsonPath('errors', ['photos.0' => ['Only JPEG, PNG or WebP photos can be added.']]);

        // Looks like a PNG (a valid header) but can't be decoded.
        $this->writeWithPhotos($customer, [$png(), self::upload('broken.png', substr(TestImages::png(), 0, 60))])->assertUnprocessable()
            ->assertJsonPath('errors', ['photos.1' => ['This photo couldn\'t be read.']]);
        $this->assertNothingStored();

        $this->writeWithPhotos($customer, ['not-a-file'])->assertUnprocessable()->assertJsonValidationErrors('photos.0');
        $this->assertNothingStored();

        // The Bangla messages.
        $this->app['auth']->forgetGuards();
        $this->post("/api/v1/products/{$this->product->id}/reviews",
            ['rating' => 4, 'comment' => 'Works well for me.', 'photos' => [$png(), $png(), $png(), $png()]],
            ['Authorization' => $customer['Authorization'], 'Accept' => 'application/json', 'Accept-Language' => 'bn'])
            ->assertUnprocessable()->assertJsonPath('errors.photos', ['সর্বোচ্চ ৩টি ছবি যোগ করুন।']);
    }

    public function test_a_failed_save_deletes_the_files_already_written(): void
    {
        $this->enable();
        $customer = $this->customer();
        // The second photo's row fails (a name that is already taken can't happen by chance, so force a failure).
        ReviewPhoto::creating(function (ReviewPhoto $photo) {
            if ($photo->position === 1) {
                throw new \RuntimeException('Database went away.');
            }
        });

        $this->withoutExceptionHandling();
        try {
            $this->writeWithPhotos($customer, [self::upload('a.png', TestImages::png()), self::upload('b.png', TestImages::png())]);
            $this->fail('The upload should have failed.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Database went away.', $e->getMessage());
        }
        $this->assertNothingStored();
    }

    public function test_hidden_data_is_removed_and_large_photos_are_shrunk_with_gd(): void
    {
        $this->assertTrue(app(ReviewPhotoProcessor::class)->usesGd(), 'This computer\'s PHP has GD.');
        $this->enable();

        $this->writeWithPhotos($this->customer(), [
            self::upload('gps.jpg', TestImages::jpegWithGps(40, 20, orientation: 6)), // taken sideways: shown 20 × 40
            self::upload('wide.png', TestImages::png(3000, 1500)),
            self::upload('meta.webp', TestImages::webpWithMetadata(40, 30)),
        ])->assertCreated();

        [$jpeg, $png, $webp] = ReviewPhoto::orderBy('position')->get()->all();
        $bytes = Storage::disk('local')->get($jpeg->path);
        $this->assertStringNotContainsString('Exif', $bytes);
        $this->assertStringNotContainsString('GPS', $bytes);
        $this->assertSame([20, 40], [$jpeg->width, $jpeg->height]); // the orientation flag was applied
        $this->assertSame([20, 40], array_slice(getimagesizefromstring($bytes), 0, 2));

        $this->assertSame([1600, 800], [$png->width, $png->height]); // the longest side is at most 1600 px
        $this->assertSame([1600, 800], array_slice(getimagesizefromstring(Storage::disk('local')->get($png->path)), 0, 2));

        $webpBytes = Storage::disk('local')->get($webp->path);
        $this->assertStringNotContainsString('GPS', $webpBytes);
        $this->assertStringNotContainsString('EXIF', $webpBytes);
    }

    public function test_a_png_keeps_its_transparency(): void
    {
        $this->enable();
        $this->writeWithPhotos($this->customer(), [self::upload('see-through.png', TestImages::png(10, 10, transparent: true))])->assertCreated();

        $image = imagecreatefromstring(Storage::disk('local')->get(ReviewPhoto::sole()->path));
        $this->assertGreaterThan(0, (imagecolorat($image, 5, 5) >> 24) & 0x7F);
    }

    public function test_hidden_data_is_removed_without_gd_too(): void
    {
        $this->app->instance(ReviewPhotoProcessor::class, new ReviewPhotoProcessor(app(ImageResizer::class), useGd: false));
        $this->assertFalse(app(ReviewPhotoProcessor::class)->usesGd());
        $this->enable();

        $this->writeWithPhotos($this->customer(), [
            self::upload('gps.jpg', TestImages::jpegWithGps(40, 20)),
            self::upload('text.png', TestImages::pngWithText(30, 30)),
            self::upload('meta.webp', TestImages::webpWithMetadata(40, 30)),
        ])->assertCreated();

        foreach (ReviewPhoto::orderBy('position')->get() as $photo) {
            $bytes = Storage::disk('local')->get($photo->path);
            $this->assertStringNotContainsString('Exif', $bytes, $photo->name);
            $this->assertStringNotContainsString('GPS', $bytes, $photo->name);
        }
        // The pixels are kept as they are (no shrinking without GD).
        $this->assertSame([[40, 20], [30, 30], [40, 30]], ReviewPhoto::orderBy('position')->get()->map(fn ($p) => [$p->width, $p->height])->all());
        $this->assertSame(TestImages::png(30, 30), Storage::disk('local')->get(ReviewPhoto::where('position', 1)->sole()->path));

        // A broken file is still a 422 for that photo, never a 500.
        $this->writeWithPhotos($this->customer(), [self::upload('broken.png', substr(TestImages::png(), 0, 60))])->assertUnprocessable()
            ->assertJsonPath('errors', ['photos.0' => ['This photo couldn\'t be read.']]);
    }

    public function test_the_public_photo_endpoint_serves_only_visible_photos_of_approved_reviews(): void
    {
        $pending = $this->reviewWithPhotos(approve: false);
        $this->getJson('/api/v1/review-photos/'.$pending->photos[0]->name)->assertNotFound()->assertExactJson(['message' => 'Photo not found.']);

        $review = $this->reviewWithPhotos();
        [$first, $second] = $review->photos->all();
        $response = $this->get("/api/v1/review-photos/{$first->name}")->assertOk()
            ->assertHeader('Content-Type', 'image/png')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        $this->assertSame(['max-age=300', 'public'], self::directives($response));
        $this->assertSame(Storage::disk('local')->get($first->path), $response->getContent());

        // Hidden → 404, shown again → 200.
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}/photos/{$second->id}", ['hidden' => true])->assertOk();
        $this->getJson("/api/v1/review-photos/{$second->name}")->assertNotFound();
        $this->get("/api/v1/review-photos/{$first->name}")->assertOk();

        // Rejected → 404.
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}", ['status' => 'rejected'])->assertOk();
        $this->getJson("/api/v1/review-photos/{$first->name}")->assertNotFound();

        // Bad or unknown names → the same 404.
        foreach (['nope.jpg', strtoupper(bin2hex(random_bytes(16))).'.png', bin2hex(random_bytes(16)).'.svg',
            bin2hex(random_bytes(16)).'.png', $first->name.'x', substr($first->name, 0, -4).'-320.webp', '..%2F..%2F.env'] as $name) {
            $this->getJson("/api/v1/review-photos/{$name}")->assertNotFound();
        }

        // The product deleted → 404.
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}", ['status' => 'approved'])->assertOk();
        $this->get("/api/v1/review-photos/{$first->name}")->assertOk();
        $this->product->delete();
        $this->getJson("/api/v1/review-photos/{$first->name}")->assertNotFound();
    }

    public function test_the_public_review_shape_lists_visible_photos_and_the_count(): void
    {
        Review::factory()->create(['product_id' => $this->product->id, 'rating' => 5]); // no photos
        $review = $this->reviewWithPhotos();
        $this->reviewWithPhotos([self::upload('c.png', TestImages::png())], approve: false); // pending: not counted
        [$first, $second] = $review->photos->all();

        $page = $this->getJson("/api/v1/products/{$this->product->id}")->assertOk()->assertJsonPath('data.review_photo_count', 2);
        $reviews = collect($page->json('data.reviews'))->keyBy('id');
        $this->assertCount(2, $reviews);
        $this->assertSame([
            ['id' => $first->id, 'url' => "/media/reviews/{$first->name}", 'width' => 40, 'height' => 30],
            ['id' => $second->id, 'url' => "/media/reviews/{$second->name}", 'width' => 30, 'height' => 40],
        ], $reviews[$review->id]['photos']);
        $this->assertSame([], $reviews->except($review->id)->first()['photos']);

        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}/photos/{$first->id}", ['hidden' => true])->assertOk();
        $this->getJson("/api/v1/products/{$this->product->id}")->assertJsonPath('data.review_photo_count', 1)
            ->assertJsonPath('data.reviews.'.$reviews->keys()->search($review->id).'.photos', [
                ['id' => $second->id, 'url' => "/media/reviews/{$second->name}", 'width' => 30, 'height' => 40],
            ]);
        // Lists don't carry it.
        $this->assertArrayNotHasKey('review_photo_count', $this->getJson('/api/v1/products')->json('data.0'));
    }

    public function test_staff_see_photos_filter_them_and_hide_them_with_an_audit(): void
    {
        $review = $this->reviewWithPhotos(approve: false);
        Review::factory()->pending()->create(['product_id' => $this->product->id]);
        [$first, $second] = $review->photos->all();

        $list = $this->asAdmin($this->admin, 'GET', '/api/admin/v1/reviews?has_photos=1')->assertOk()->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $review->id);
        $this->assertSame([
            ['id' => $first->id, 'hidden' => false, 'width' => 40, 'height' => 30, 'size_bytes' => $first->size_bytes, 'position' => 0],
            ['id' => $second->id, 'hidden' => false, 'width' => 30, 'height' => 40, 'size_bytes' => $second->size_bytes, 'position' => 1],
        ], $list->json('data.0.photos'));
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/reviews')->assertJsonPath('meta.total', 2);
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/reviews?has_photos=0')->assertJsonPath('meta.total', 2);
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/reviews?has_photos=maybe')->assertJsonValidationErrors('has_photos');

        // Hide photo 2: audited once; the same again changes nothing and isn't audited.
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}/photos/{$second->id}", ['hidden' => true])->assertOk()
            ->assertJsonPath('data.id', $review->id)->assertJsonPath('data.photos.1.hidden', true)->assertJsonPath('data.photos.0.hidden', false);
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}/photos/{$second->id}", ['hidden' => true])->assertOk();
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}/photos/{$second->id}", ['hidden' => false])->assertOk()
            ->assertJsonPath('data.photos.1.hidden', false);
        $logs = AuditLog::where('action', 'like', 'review.photo_%')->orderBy('id')->get();
        $this->assertSame(['review.photo_hidden', 'review.photo_shown'], $logs->pluck('action')->all());
        $this->assertSame("Photo 2 of review #{$review->id} on product MUG-01 hidden.", $logs[0]->summary);
        $this->assertSame("Photo 2 of review #{$review->id} on product MUG-01 shown.", $logs[1]->summary);

        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}/photos/{$second->id}", [])->assertJsonValidationErrors('hidden');
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}/photos/{$second->id}", ['hidden' => 'perhaps'])->assertJsonValidationErrors('hidden');
    }

    public function test_the_staff_photo_endpoint_works_in_every_status_and_needs_reviews_view(): void
    {
        $review = $this->reviewWithPhotos(approve: false);
        $other = $this->reviewWithPhotos([self::upload('c.png', TestImages::png())], approve: false);
        $photo = $review->photos[0];
        $url = "/api/admin/v1/reviews/{$review->id}/photos/{$photo->id}";

        foreach (['pending', 'approved', 'rejected'] as $status) {
            $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}", ['status' => $status])->assertOk();
            $this->app['auth']->forgetGuards();
            $response = $this->get($url, $this->admin)->assertOk()
                ->assertHeader('Content-Type', 'image/png')
                ->assertHeader('X-Content-Type-Options', 'nosniff')
                ->assertHeader('Content-Security-Policy', "default-src 'none'; sandbox");
            $this->assertSame(['no-store', 'private'], self::directives($response));
            $this->assertSame(Storage::disk('local')->get($photo->path), $response->getContent());
        }
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}/photos/{$photo->id}", ['hidden' => true])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->get($url, $this->admin)->assertOk();

        // Another review's photo, or an unknown one → 404 (reading and hiding).
        $this->asAdmin($this->admin, 'GET', "/api/admin/v1/reviews/{$review->id}/photos/{$other->photos[0]->id}")->assertNotFound();
        $this->asAdmin($this->admin, 'GET', "/api/admin/v1/reviews/{$review->id}/photos/999999")->assertNotFound();
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/reviews/{$review->id}/photos/{$other->photos[0]->id}", ['hidden' => true])->assertNotFound();
        $this->assertFalse($other->photos[0]->fresh()->hidden);

        // Permissions: Viewer reads but can't hide; Sales staff can't read.
        $viewer = $this->signInAdmin(Admin::factory()->role('Viewer')->create());
        $this->asAdmin($viewer, 'GET', $url)->assertOk();
        $this->asAdmin($viewer, 'PATCH', $url, ['hidden' => false])->assertForbidden()->assertJsonPath('permission', 'reviews.moderate');
        $sales = $this->signInAdmin(Admin::factory()->role('Sales staff')->create());
        $this->asAdmin($sales, 'GET', $url)->assertForbidden()->assertJsonPath('permission', 'reviews.view');
        // Customers can't use it.
        $this->app['auth']->forgetGuards();
        $this->getJson($url, ['Authorization' => $this->customer()['Authorization']])->assertForbidden();
    }

    public function test_deleting_a_review_deletes_its_files(): void
    {
        $review = $this->reviewWithPhotos();
        $paths = $review->photos->pluck('path')->all();
        $name = $review->photos[0]->name;
        foreach ($paths as $path) {
            Storage::disk('local')->assertExists($path);
        }

        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/reviews/{$review->id}")->assertNoContent();

        $this->assertSame(0, ReviewPhoto::count());
        foreach ($paths as $path) {
            Storage::disk('local')->assertMissing($path);
        }
        Storage::disk('local')->assertMissing("review-photos/{$review->id}");
        $this->getJson("/api/v1/review-photos/{$name}")->assertNotFound();
    }

    public function test_an_erased_customer_keeps_the_review_but_loses_the_photos(): void
    {
        $review = $this->reviewWithPhotos(customerAttributes: ['email' => 'erase-me@example.com']);
        $kept = $this->reviewWithPhotos([self::upload('c.png', TestImages::png())], customerAttributes: ['email' => 'someone@example.com']);
        $paths = $review->photos->pluck('path')->all();

        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/customers/{$review->customer_id}")->assertNoContent();

        $review->refresh();
        $this->assertNull($review->customer_id);
        $this->assertSame('approved', $review->status);
        $this->assertSame(0, $review->photos()->count());
        foreach ($paths as $path) {
            Storage::disk('local')->assertMissing($path);
        }
        // Somebody else's photos stay.
        $this->assertSame(1, $kept->photos()->count());
        Storage::disk('local')->assertExists($kept->photos[0]->path);
        $this->getJson("/api/v1/products/{$this->product->id}")->assertJsonPath('data.review_photo_count', 1);
    }
}
