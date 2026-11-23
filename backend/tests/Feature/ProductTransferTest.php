<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AuditLog;
use App\Models\Brand;
use App\Models\Category;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 5: products as CSV (export, and import with a dry run). */
class ProductTransferTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private const HEADER = 'sku,name,category_slug,brand,price,discount_percent,stock_quantity,status,description,tags,image_urls,'
        .'specifications,related_skus,upsell_skus,crosssell_skus' // phase 11
        .',name_bn,short_description_bn,description_bn,meta_title_bn,meta_description_bn'; // phase 13

    private array $admin;

    private Category $beauty;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = $this->adminHeaders();
        $this->beauty = Category::factory()->create(['slug' => 'beauty', 'name' => 'Beauty']);
    }

    private function import(string $csv, ?bool $dryRun = null, ?array $headers = null)
    {
        $this->app['auth']->forgetGuards();
        $body = ['file' => UploadedFile::fake()->createWithContent('products.csv', $csv)];
        if ($dryRun !== null) {
            $body['dry_run'] = $dryRun ? '1' : '0';
        }

        return $this->post('/api/admin/v1/products/import', $body, [...($headers ?? $this->admin), 'Accept' => 'application/json']);
    }

    public function test_export_uses_the_list_filters_and_neutralizes_formulas(): void
    {
        $brand = Brand::create(['name' => '@Evil Brand']);
        $product = $this->product(['sku' => 'MUG-1', 'name' => '=HYPERLINK("http://x","click")', 'category_id' => $this->beauty->id, 'brand_id' => $brand->id,
            'price' => '9.50', 'discount_percent' => '5.00', 'stock_quantity' => 7, 'description' => "-2+3\nSecond line", 'tags' => ['a', 'b']]);
        $product->images()->create(['url' => 'https://cdn.example.com/1.webp', 'position' => 0]);
        $product->images()->create(['url' => 'https://cdn.example.com/2.webp', 'position' => 1]);
        $this->product(['sku' => 'DRAFT-1', 'status' => 'draft']);

        $this->app['auth']->forgetGuards();
        $response = $this->get('/api/admin/v1/products/export.csv?status=active', $this->admin)->assertOk();
        $this->assertStringStartsWith('text/csv', $response->headers->get('Content-Type'));
        $this->assertStringContainsString('attachment; filename="products-', $response->headers->get('Content-Disposition'));

        $stream = fopen('php://temp', 'r+');
        fwrite($stream, $response->getContent());
        rewind($stream);
        $rows = [];
        while (($row = fgetcsv($stream, escape: '')) !== false) {
            $rows[] = $row;
        }
        $this->assertSame(explode(',', self::HEADER), $rows[0]);
        $this->assertCount(2, $rows); // the draft is filtered out
        $this->assertSame(['MUG-1', '\'=HYPERLINK("http://x","click")', 'beauty', "'@Evil Brand", '9.50', '5.00', '7', 'active',
            "'-2+3\nSecond line", 'a|b', 'https://cdn.example.com/1.webp|https://cdn.example.com/2.webp', '', '', '', '', '', '', '', '', ''], $rows[1]); // phase 13: 5 empty Bangla cells
    }

    public function test_a_dry_run_reports_without_saving(): void
    {
        $existing = $this->product(['sku' => 'OLD-1', 'name' => 'Old One', 'price' => '5.00', 'category_id' => $this->beauty->id]);
        $same = $this->product(['sku' => 'SAME-1', 'name' => 'Same One', 'price' => '3.00']);
        $csv = "\xEF\xBB\xBF".implode("\n", [
            'name,SKU,price,category_slug', // any order, any case, BOM
            'New Cream,NEW-1,12.50,beauty',
            'Old One Renamed,OLD-1,5.00,',
            'Same One,SAME-1,3,',
            '',
        ]);

        $this->import($csv)->assertOk()->assertExactJson(['data' => [
            'dry_run' => true, 'rows' => 3, 'created' => 1, 'updated' => 1, 'unchanged' => 1, 'errors' => [], 'warnings' => [], // phase 11: warnings
        ]]);
        $this->assertNull(Product::where('sku', 'NEW-1')->first());
        $this->assertSame('Old One', $existing->fresh()->name);
        $this->assertSame(0, AuditLog::where('action', 'product.imported')->count());

        $this->import($csv, dryRun: false)->assertOk()->assertJsonPath('data.dry_run', false)->assertJsonPath('data.created', 1);
        $new = Product::where('sku', 'NEW-1')->sole();
        $this->assertSame(['New Cream', 'draft', '12.50', 'beauty', 0], [$new->name, $new->status, $new->price, $new->category->slug, $new->stock_quantity]);
        $this->assertSame('Old One Renamed', $existing->fresh()->name);
        $this->assertSame('3.00', $same->fresh()->price);

        $entry = AuditLog::where('action', 'product.imported')->sole();
        $this->assertSame(['rows' => 3, 'created' => 1, 'updated' => 1, 'unchanged' => 1], $entry->changes['after']);
    }

    public function test_any_error_saves_nothing_and_lists_rows_and_columns(): void
    {
        $this->product(['sku' => 'TAKEN-1']);
        $csv = implode("\n", [
            self::HEADER,
            'GOOD-1,Good Thing,beauty,Acme,10.00,0,5,active,Fine.,x|y,https://cdn.example.com/a.webp',
            'NEW-2,No Category,,,10.00,,,,,,',
            'bad sku!,Bad Sku,beauty,,1,,,,,,',
            'NEW-3,Bad Price,beauty,,1.999,,,,,,',
            'NEW-4,Bad Status,beauty,,1,,,sold,,,',
            'NEW-5,X,nope,,1,,-3,,,,',
            'NEW-6,Plain Http,beauty,,1,95,,,,,http://cdn.example.com/a.webp',
            'GOOD-1,Twice,beauty,,1,,,,,,',
        ]);

        $errors = $this->import($csv, dryRun: false)->assertOk()->assertJsonPath('data.rows', 8)->json('data.errors');
        $pairs = array_map(fn ($e) => [$e['row'], $e['column']], $errors);
        foreach ([[3, 'category_slug'], [4, 'sku'], [5, 'price'], [6, 'status'], [7, 'name'], [7, 'category_slug'], [7, 'stock_quantity'],
            [8, 'discount_percent'], [8, 'image_urls'], [9, 'sku']] as $expected) {
            $this->assertContains($expected, $pairs, 'Missing error '.json_encode($expected));
        }
        $this->assertSame(['row', 'column', 'message'], array_keys($errors[0]));
        $this->assertSame(1, Product::count()); // not even GOOD-1
        $this->assertSame(0, AuditLog::where('action', 'product.imported')->count());
    }

    public function test_header_and_file_problems(): void
    {
        $this->import("name,price,colour\nA,1,red")->assertOk()->assertJsonPath('data.errors', [
            ['row' => 1, 'column' => 'colour', 'message' => 'Unknown column. Known columns: '.str_replace(',', ', ', self::HEADER).'.'],
            ['row' => 1, 'column' => 'sku', 'message' => 'The file needs a sku column.'],
        ]);
        $this->import('')->assertJsonValidationErrors('file');
        $this->import("sku,name\n")->assertJsonValidationErrors(['file' => 'no products']);
        $this->import("sku,name\nA-1,\xFF\xFEbad")->assertJsonValidationErrors(['file' => 'UTF-8']);
        $this->import("sku,name\n".str_repeat("A-1,Thing\n", 5001))->assertJsonValidationErrors(['file' => 'at most 5,000']);

        $this->app['auth']->forgetGuards();
        $this->post('/api/admin/v1/products/import', ['file' => UploadedFile::fake()->create('big.csv', 2049, 'text/csv')], [...$this->admin, 'Accept' => 'application/json'])
            ->assertJsonValidationErrors(['file' => '2 MB']);
    }

    public function test_images_are_added_only_when_new_and_https(): void
    {
        $product = $this->product(['sku' => 'IMG-1', 'thumbnail_url' => null]);
        $product->images()->create(['url' => 'https://cdn.example.com/have.webp', 'position' => 0]);
        $csv = "sku,name,image_urls\nIMG-1,{$product->name},https://cdn.example.com/have.webp|https://cdn.example.com/new.webp";

        $this->import($csv, dryRun: false)->assertOk()->assertJsonPath('data.updated', 1)->assertJsonPath('data.errors', []);
        $this->assertSame(['https://cdn.example.com/have.webp', 'https://cdn.example.com/new.webp'], $product->images()->pluck('url')->all());
        $this->assertSame('https://cdn.example.com/have.webp', $product->fresh()->thumbnail_url);

        // The same file again changes nothing.
        $this->import($csv, dryRun: false)->assertOk()->assertJsonPath('data.unchanged', 1);
        $this->assertSame(2, $product->images()->count());
    }

    public function test_an_export_imports_back_unchanged(): void
    {
        $this->product(['sku' => 'RT-1', 'category_id' => $this->beauty->id, 'tags' => ['x'], 'description' => '=1+1']);
        $this->product(['sku' => 'RT-2', 'category_id' => $this->beauty->id]);
        $this->app['auth']->forgetGuards();
        $csv = $this->get('/api/admin/v1/products/export.csv', $this->admin)->assertOk()->getContent();

        // The description came out as '=1+1 (safe for spreadsheets); reading it back is a change the shop would see, so only that row differs.
        $this->import($csv)->assertOk()->assertJsonPath('data.errors', [])->assertJsonPath('data.rows', 2)
            ->assertJsonPath('data.unchanged', 1)->assertJsonPath('data.updated', 1);
    }

    public function test_import_and_export_need_products_import(): void
    {
        $role = Admin::factory()->role(['products.view', 'products.edit'])->create();
        $headers = $this->signInAdmin($role);

        $this->import("sku,name\nA-1,Thing", headers: $headers)->assertForbidden()->assertJsonPath('permission', 'products.import');
        $this->app['auth']->forgetGuards();
        $this->get('/api/admin/v1/products/export.csv', [...$headers, 'Accept' => 'application/json'])->assertForbidden()->assertJsonPath('permission', 'products.import');

        $manager = $this->signInAdmin(Admin::factory()->role('Catalog manager')->create());
        $this->import("sku,name\nA-1,Thing", headers: $manager)->assertOk();
    }
}
