<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductImage;
use App\Services\ImageResizer;
use App\Support\ImageVariants;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/**
 * Phase 9 (part B): resized copies of uploaded product photos. The size and
 * name rules are tested everywhere; the tests that make real copies need
 * PHP's GD (with JPEG, PNG and WebP) and are skipped without it.
 */
class ImageResizeTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private const HEX = '0123456789abcdef0123456789abcdef';

    private array $admin;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $this->admin = $this->adminHeaders();
        $this->product = $this->product(['thumbnail_url' => 'https://cdn.example.com/old.webp']);
    }

    private function requireGd(): void
    {
        if (! app(ImageResizer::class)->available()) {
            $this->markTestSkipped('GD with JPEG, PNG and WebP support is not installed in this PHP, so resized copies can\'t be made here (the production image has it).');
        }
    }

    /** A real image of $width × $height, encoded as $type (png or jpg). */
    private function image(int $width, int $height, string $type = 'png'): UploadedFile
    {
        $image = imagecreatetruecolor($width, $height);
        imagefill($image, 0, 0, imagecolorallocate($image, 30, 120, 200));
        ob_start();
        $type === 'png' ? imagepng($image) : imagejpeg($image, null, 90);

        return UploadedFile::fake()->createWithContent("photo.{$type}", (string) ob_get_clean());
    }

    private function upload(array $files)
    {
        $this->app['auth']->forgetGuards();

        return $this->post("/api/admin/v1/products/{$this->product->id}/images", ['images' => $files], [...$this->admin, 'Accept' => 'application/json']);
    }

    public function test_sizes_are_widths_and_never_upscaled(): void
    {
        $this->assertSame([320 => [320, 213], 960 => [960, 640]], ImageVariants::plan(1200, 800));
        $this->assertSame([320 => [320, 640]], ImageVariants::plan(500, 1000));   // tall: still by width
        $this->assertSame([320 => [320, 1], 960 => [960, 2]], ImageVariants::plan(6000, 10)); // never 0 px high
        $this->assertSame([], ImageVariants::plan(320, 200));                     // already that small: no copy
        $this->assertSame([], ImageVariants::plan(100, 100));
        $this->assertSame([], ImageVariants::plan(0, 0));
    }

    public function test_copy_names_sit_next_to_the_original(): void
    {
        $original = 'products/12/'.self::HEX.'.jpg';
        $this->assertSame('products/12/'.self::HEX.'-320.webp', ImageVariants::path($original, 320, ImageVariants::extension('jpg', true)));
        $this->assertSame('products/12/'.self::HEX.'-960.jpg', ImageVariants::path($original, 960, ImageVariants::extension('jpg', false)));
        $this->assertNull(ImageVariants::path($original, 500, 'webp'));                       // not a size
        $this->assertNull(ImageVariants::path('products/12/'.self::HEX.'-320.webp', 320, 'webp')); // a copy isn't an original
        $this->assertNull(ImageVariants::path('../etc/passwd', 320, 'webp'));

        // The store's /media allow-list accepts exactly these names.
        $allow = '#^products/\d+/[a-f0-9]{32}(-(320|960))?\.(jpg|png|webp)$#';
        $this->assertMatchesRegularExpression($allow, ImageVariants::path($original, 320, 'webp'));
        $this->assertSame('/media/products/12/'.self::HEX.'-320.webp', ImageVariants::url('products/12/'.self::HEX.'-320.webp'));
        $this->assertSame('products/12/'.self::HEX.'-960.png', ImageVariants::pathFromUrl('/media/products/12/'.self::HEX.'-960.png'));
        $this->assertNull(ImageVariants::pathFromUrl('/media/products/12/'.self::HEX.'.png')); // the original is never "a copy"
        $this->assertNull(ImageVariants::pathFromUrl('https://cdn.example.com/x-320.webp'));

        $this->assertSame('{}', json_encode(ImageVariants::forApi(null)));
        $this->assertSame('{"320":"/a.webp"}', json_encode(ImageVariants::forApi(['320' => '/a.webp', '500' => '/b.webp']), JSON_UNESCAPED_SLASHES));
    }

    public function test_without_gd_uploads_keep_working_with_the_original_only(): void
    {
        $this->mock(ImageResizer::class, function ($mock) {
            $mock->shouldReceive('make')->andReturn([]);
            $mock->shouldReceive('deleteCopies');
        });
        // A tiny PNG (no GD needed to make it).
        $png = UploadedFile::fake()->createWithContent('a.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='));
        $image = $this->upload([$png])->assertCreated()->json('data.0');
        $this->assertSame(['id', 'url', 'alt', 'position', 'is_upload', 'variants'], array_keys($image));
        $this->assertSame([], $image['variants']); // {} in JSON
        $this->assertStringContainsString('"variants":{}', $this->upload([$png])->getContent());
    }

    public function test_an_upload_gets_webp_copies_that_are_never_upscaled(): void
    {
        $this->requireGd();

        $images = $this->upload([$this->image(1200, 600), $this->image(500, 400, 'jpg'), $this->image(200, 200)])->assertCreated()->json('data');

        $hex = fn (string $url) => substr(basename($url), 0, 32);
        $big = $images[0];
        $this->assertSame([
            '320' => "/media/products/{$this->product->id}/{$hex($big['url'])}-320.webp",
            '960' => "/media/products/{$this->product->id}/{$hex($big['url'])}-960.webp",
        ], $big['variants']);
        $this->assertSame([320], array_keys($images[1]['variants'])); // JSON object keys: PHP makes them ints
        $this->assertSame([], $images[2]['variants']);

        $disk = Storage::disk('public');
        foreach (['320' => [320, 160], '960' => [960, 480]] as $size => [$width, $height]) {
            $file = substr($big['variants'][$size], strlen('/media/'));
            $info = getimagesizefromstring($disk->get($file));
            $this->assertSame([$width, $height, IMAGETYPE_WEBP], [$info[0], $info[1], $info[2]]);
        }

        // Product cards and the store's gallery get them too.
        $this->assertSame($big['variants'], $this->product->fresh()->thumbnail_variants);
        $this->app['auth']->forgetGuards();
        $public = $this->getJson("/api/v1/products/{$this->product->id}")->assertOk();
        $public->assertJsonPath('data.thumbnail_variants', $big['variants']);
        $public->assertJsonPath('data.images.0.variants', $big['variants']);
        $this->assertSame(['url', 'alt', 'variants'], array_keys($public->json('data.images.0')));
        $this->getJson('/api/v1/products')->assertOk(); // lists include thumbnail_variants without loading images

        // Deleting the image deletes its copies.
        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/products/{$this->product->id}/images/{$big['id']}")->assertOk();
        $this->assertFalse($disk->exists(substr($big['variants']['320'], 7)));
        $this->assertFalse($disk->exists(substr($big['variants']['960'], 7)));
        $this->assertSame($images[1]['variants'], $this->product->fresh()->thumbnail_variants); // the new first image's
    }

    public function test_copies_drop_the_photo_metadata(): void
    {
        $this->requireGd();

        // A JPEG with an EXIF block (camera details) and a comment.
        $jpeg = (string) $this->image(800, 600, 'jpg')->get();
        $exif = "Exif\0\0MM\0*\0\0\0\x08\0\0".'SECRET-GPS-NOTE';
        $withMeta = substr($jpeg, 0, 2)."\xFF\xE1".pack('n', strlen($exif) + 2).$exif."\xFF\xFE".pack('n', 17).'SECRET-COMMENT!'.substr($jpeg, 2);
        $image = $this->upload([UploadedFile::fake()->createWithContent('m.jpg', $withMeta)])->assertCreated()->json('data.0');

        $copy = Storage::disk('public')->get(substr($image['variants']['320'], 7));
        $this->assertStringNotContainsString('SECRET', $copy);
    }

    public function test_the_command_resizes_existing_uploads(): void
    {
        $this->requireGd();

        // An upload from before phase 9 (no copies), and an imported image (left alone).
        $name = self::HEX.'.png';
        Storage::disk('public')->put("products/{$this->product->id}/{$name}", (string) $this->image(1000, 500)->get());
        $old = $this->product->images()->create(['url' => "/media/products/{$this->product->id}/{$name}", 'path' => "products/{$this->product->id}/{$name}", 'alt' => 'x', 'position' => 0]);
        $external = $this->product->images()->create(['url' => 'https://cdn.example.com/a.webp', 'alt' => 'x', 'position' => 1]);
        $this->product->syncThumbnail();

        $this->artisan('buynest:images:resize')->expectsOutputToContain('Resized 1 photo')->assertSuccessful();
        $this->assertSame([320, 960], array_keys($old->fresh()->variants));
        $this->assertNull($external->fresh()->variants);
        $this->assertSame($old->fresh()->variants, $this->product->fresh()->thumbnail_variants);

        // Done already: nothing to do without --force.
        $this->artisan('buynest:images:resize')->expectsOutputToContain('Resized 0 photos')->assertSuccessful();
        $this->artisan('buynest:images:resize --force')->expectsOutputToContain('Resized 1 photo')->assertSuccessful();
    }

    public function test_the_command_explains_when_gd_is_missing(): void
    {
        $this->mock(ImageResizer::class, fn ($mock) => $mock->shouldReceive('available')->andReturn(false));
        $this->artisan('buynest:images:resize')->expectsOutputToContain('GD is not installed')->assertFailed();
    }

    public function test_a_resize_failure_never_refuses_the_upload(): void
    {
        $this->mock(ImageResizer::class, function ($mock) {
            $mock->shouldReceive('make')->andThrow(new \RuntimeException('disk full'));
        });
        $png = UploadedFile::fake()->createWithContent('a.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='));
        $this->upload([$png])->assertCreated()->assertJsonPath('data.0.variants', []);
        $this->assertSame(1, ProductImage::count());
    }
}
