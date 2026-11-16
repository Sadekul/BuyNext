<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AuditLog;
use App\Models\Product;
use App\Models\ProductImage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 5: uploaded product images, checked by their contents. */
class ProductImageTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    private const JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

    private const WEBP = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

    private const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    private array $admin;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $this->admin = $this->adminHeaders();
        $this->product = $this->product(['thumbnail_url' => 'https://cdn.example.com/old-thumb.webp']);
    }

    private function file(string $name, string $base64OrBytes, bool $raw = false): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, $raw ? $base64OrBytes : base64_decode($base64OrBytes));
    }

    private function upload(array $files, ?array $headers = null)
    {
        $this->app['auth']->forgetGuards();

        return $this->post("/api/admin/v1/products/{$this->product->id}/images", ['images' => $files], [...($headers ?? $this->admin), 'Accept' => 'application/json']);
    }

    public function test_jpeg_png_and_webp_are_stored_under_random_names(): void
    {
        $response = $this->upload([$this->file('My Photo.png', self::PNG), $this->file('b.jpeg', self::JPEG), $this->file('c.webp', self::WEBP)])
            ->assertCreated();

        $images = $response->json('data');
        $this->assertCount(3, $images);
        $this->assertSame(['id', 'url', 'alt', 'position', 'is_upload'], array_keys($images[0]));
        $this->assertSame([0, 1, 2], array_column($images, 'position'));
        $this->assertSame([true, true, true], array_column($images, 'is_upload'));
        $this->assertSame($this->product->name, $images[0]['alt']);
        foreach (['png', 'jpg', 'webp'] as $index => $extension) {
            $this->assertMatchesRegularExpression('#^/media/products/'.$this->product->id.'/[a-f0-9]{32}\.'.$extension.'$#', $images[$index]['url']);
            $path = ProductImage::find($images[$index]['id'])->path;
            $this->assertSame(substr($images[$index]['url'], strlen('/media/')), $path);
            Storage::disk('public')->assertExists($path);
        }
        $this->assertStringNotContainsString('My Photo', $images[0]['url']);
        // The original bytes.
        $this->assertSame(base64_decode(self::PNG), Storage::disk('public')->get(ProductImage::find($images[0]['id'])->path));

        // The thumbnail follows the first image.
        $this->assertSame($images[0]['url'], $this->product->fresh()->thumbnail_url);
        $this->assertSame(1, AuditLog::where('action', 'product.images_added')->count());

        // The admin detail lists them with ids; the storefront with url and alt.
        $this->asAdmin($this->admin, 'GET', "/api/admin/v1/products/{$this->product->id}")->assertJsonPath('data.images.0.id', $images[0]['id']);
        $this->getJson("/api/v1/products/{$this->product->id}")->assertJsonPath('data.images.0', ['url' => $images[0]['url'], 'alt' => $this->product->name]);
    }

    public function test_files_are_judged_by_their_contents_not_their_names(): void
    {
        $fakes = [
            'php.jpg' => "<?php system(\$_GET['c']); ?>",
            'svg.jpg' => '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
            'page.png' => '<!doctype html><html><body><script>alert(1)</script></body></html>',
            'magic.jpg' => "\xFF\xD8\xFF\xE0<?php echo 1; ?>", // JPEG magic bytes, then PHP: no real image header
            'anim.webp' => base64_decode(self::GIF),           // a real image, but not an allowed type
        ];
        foreach ($fakes as $name => $bytes) {
            $this->upload([$this->file($name, $bytes, raw: true)])->assertUnprocessable()->assertJsonValidationErrors('images.0');
        }
        // One bad file refuses the whole request.
        $this->upload([$this->file('ok.png', self::PNG), $this->file('bad.jpg', '<?php ?>', raw: true)])
            ->assertJsonValidationErrors('images.1')->assertJsonMissingValidationErrors('images.0');

        $this->assertSame(0, ProductImage::count());
        $this->assertSame([], Storage::disk('public')->allFiles());
        $this->assertSame('https://cdn.example.com/old-thumb.webp', $this->product->fresh()->thumbnail_url);
    }

    public function test_size_and_dimension_limits(): void
    {
        $this->upload([UploadedFile::fake()->create('big.jpg', 5121, 'image/jpeg')])->assertJsonValidationErrors(['images.0' => '5 MB']);

        $ihdr = 'IHDR'.pack('NN', 7000, 10)."\x08\x06\x00\x00\x00";
        $huge = "\x89PNG\r\n\x1a\n".pack('N', 13).$ihdr.pack('N', crc32($ihdr)).pack('N', 0).'IEND'.pack('N', crc32('IEND'));
        $this->upload([$this->file('huge.png', $huge, raw: true)])->assertJsonValidationErrors(['images.0' => '6000']);
        $this->assertSame(0, ProductImage::count());
    }

    public function test_at_most_10_per_request_and_12_per_product(): void
    {
        $eleven = array_map(fn ($i) => $this->file("{$i}.png", self::PNG), range(1, 11));
        $this->upload($eleven)->assertJsonValidationErrors(['images' => 'at most 10']);

        $this->upload(array_slice($eleven, 0, 10))->assertCreated();
        $this->upload(array_slice($eleven, 0, 3))->assertJsonValidationErrors(['images' => 'you can add 2 more']);
        $this->upload(array_slice($eleven, 0, 2))->assertCreated()->assertJsonCount(12, 'data');
        $this->upload([$this->file('x.png', self::PNG)])->assertJsonValidationErrors('images');

        $this->assertSame(12, ProductImage::count());
        $this->assertCount(12, Storage::disk('public')->allFiles());
    }

    public function test_alt_text_reorder_and_delete(): void
    {
        $ids = array_column($this->upload([$this->file('a.png', self::PNG), $this->file('b.png', self::PNG), $this->file('c.png', self::PNG)])
            ->assertCreated()->json('data'), 'id');
        [$a, $b, $c] = ProductImage::findMany($ids)->sortBy('id')->values()->all();

        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$this->product->id}/images/{$b->id}", ['alt' => 'Side view'])
            ->assertOk()->assertJsonPath('data.1.alt', 'Side view');

        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/products/{$this->product->id}/images/reorder", ['ids' => [$c->id, $a->id, $b->id]])
            ->assertOk()->assertJsonPath('data.0.id', $c->id)->assertJsonPath('data.2.id', $b->id);
        $this->assertSame($c->url, $this->product->fresh()->thumbnail_url);
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/products/{$this->product->id}/images/reorder", ['ids' => [$c->id, $a->id]])
            ->assertJsonValidationErrors('ids');

        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/products/{$this->product->id}/images/{$c->id}")
            ->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.0.id', $a->id)->assertJsonPath('data.0.position', 0);
        Storage::disk('public')->assertMissing($c->path);
        Storage::disk('public')->assertExists($a->path);
        $this->assertSame($a->url, $this->product->fresh()->thumbnail_url);

        // Another product's image is "not found".
        $other = $this->product();
        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/products/{$other->id}/images/{$a->id}")->assertNotFound();

        $this->assertSame(1, AuditLog::where('action', 'product.image_updated')->count());
        $this->assertSame(1, AuditLog::where('action', 'product.images_reordered')->count());
        $this->assertSame(1, AuditLog::where('action', 'product.image_deleted')->count());
    }

    public function test_the_product_form_keeps_uploads_it_lists_and_deleting_the_product_keeps_files(): void
    {
        $uploaded = $this->upload([$this->file('a.png', self::PNG), $this->file('b.png', self::PNG)])->assertCreated()->json('data');

        // The form sends the gallery as URLs: an upload listed again keeps its file, one left out is removed.
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$this->product->id}", ['images' => [$uploaded[1]['url'], 'https://cdn.example.com/x.webp']])
            ->assertOk()->assertJsonPath('data.images.0.id', $uploaded[1]['id'])->assertJsonPath('data.images.0.is_upload', true)
            ->assertJsonPath('data.images.1.is_upload', false)
            ->assertJsonPath('data.thumbnail_url', $uploaded[1]['url']);
        $kept = ProductImage::find($uploaded[1]['id']);
        Storage::disk('public')->assertExists($kept->path);
        $this->assertCount(1, Storage::disk('public')->allFiles());

        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/products/{$this->product->id}")->assertNoContent();
        Storage::disk('public')->assertExists($kept->path);
    }

    public function test_image_routes_need_products_edit(): void
    {
        $viewer = $this->signInAdmin(Admin::factory()->role(['products.view'])->create());
        $this->upload([$this->file('a.png', self::PNG)], $viewer)->assertForbidden()->assertJsonPath('permission', 'products.edit');
        $this->assertSame(0, ProductImage::count());
    }
}
