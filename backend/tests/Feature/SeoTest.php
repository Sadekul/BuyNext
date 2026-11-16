<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Category;
use App\Models\Page;
use App\Models\UrlRedirect;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 7 SEO: product meta fields, the sitemap, URL redirects. */
class SeoTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->headers = $this->adminHeaders();
    }

    public function test_products_have_meta_fields(): void
    {
        Category::factory()->create(['slug' => 'home']);
        $id = $this->asAdmin($this->headers, 'POST', '/api/admin/v1/products', [
            'name' => 'Blue Mug', 'category' => 'home', 'price' => 9.99, 'stock_quantity' => 5,
            'meta_title' => '  The best blue mug ', 'meta_description' => 'Holds coffee.',
        ])->assertCreated()->assertJsonPath('data.meta_title', 'The best blue mug')->json('data.id');

        $this->getJson("/api/v1/products/{$id}")->assertOk()
            ->assertJsonPath('data.meta_title', 'The best blue mug')->assertJsonPath('data.meta_description', 'Holds coffee.');
        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/products/{$id}", ['meta_title' => ''])->assertOk()->assertJsonPath('data.meta_title', null);
        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/products/{$id}", ['meta_description' => str_repeat('x', 501)])
            ->assertUnprocessable()->assertJsonValidationErrors('meta_description');
    }

    public function test_the_sitemap_lists_what_shoppers_can_see(): void
    {
        $visible = Category::factory()->create(['slug' => 'shoes']);
        $hidden = Category::factory()->create(['slug' => 'secret', 'is_active' => false]);
        $active = $this->product(['category_id' => $visible->id]);
        $draft = $this->product(['category_id' => $visible->id, 'status' => 'draft']);
        $inHidden = $this->product(['category_id' => $hidden->id]);
        Page::where('slug', 'about')->update(['is_published' => false]);

        $response = $this->get('/api/v1/sitemap.xml')->assertOk()->assertHeader('Content-Type', 'application/xml; charset=UTF-8');
        $xml = simplexml_load_string($response->getContent());
        $locs = array_map('strval', $xml->xpath('//*[local-name()="loc"]'));
        $base = config('buynest.storefront_url');

        $this->assertContains("{$base}/", $locs);
        $this->assertContains("{$base}/categories/shoes", $locs);
        $this->assertContains("{$base}/products/{$active->id}", $locs);
        $this->assertContains("{$base}/pages/privacy", $locs);
        foreach (["{$base}/categories/secret", "{$base}/products/{$draft->id}", "{$base}/products/{$inHidden->id}", "{$base}/pages/about"] as $missing) {
            $this->assertNotContains($missing, $locs);
        }
    }

    public function test_redirects_are_normalized_looked_up_and_counted(): void
    {
        $this->asAdmin($this->headers, 'POST', '/api/admin/v1/redirects', ['from_path' => '/Old-Shoes/', 'to_path' => '/categories/shoes'])
            ->assertCreated()->assertJsonPath('data.from_path', '/old-shoes')->assertJsonPath('data.status_code', 301);

        $this->getJson('/api/v1/redirects?path='.urlencode('/old-shoes/?utm=x'))->assertOk()
            ->assertJsonPath('data', ['from_path' => '/old-shoes', 'to_path' => '/categories/shoes', 'status_code' => 301]);
        $this->getJson('/api/v1/redirects?path=/nothing')->assertNotFound();
        $this->assertSame(1, UrlRedirect::sole()->hits);

        // A change clears the cached answer at once.
        $id = UrlRedirect::sole()->id;
        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/redirects/{$id}", ['to_path' => 'https://example.com/shoes', 'status_code' => 302])->assertOk();
        $this->getJson('/api/v1/redirects?path=/old-shoes')->assertJsonPath('data.to_path', 'https://example.com/shoes');
        $this->asAdmin($this->headers, 'DELETE', "/api/admin/v1/redirects/{$id}")->assertNoContent();
        $this->getJson('/api/v1/redirects?path=/old-shoes')->assertNotFound();
        $this->assertDatabaseHas('audit_log', ['action' => 'redirect.deleted']);
    }

    public function test_redirect_validation_and_loops(): void
    {
        $post = fn (array $body) => $this->asAdmin($this->headers, 'POST', '/api/admin/v1/redirects', $body);
        $post(['from_path' => 'no-slash', 'to_path' => '/x'])->assertJsonValidationErrors('from_path');
        $post(['from_path' => '/a?b=1', 'to_path' => '/x'])->assertJsonValidationErrors('from_path');
        $post(['from_path' => '/a', 'to_path' => 'http://insecure.example'])->assertJsonValidationErrors('to_path');
        $post(['from_path' => '/a', 'to_path' => '//evil.example'])->assertJsonValidationErrors('to_path');
        $post(['from_path' => '/a', 'to_path' => '/b', 'status_code' => 307])->assertJsonValidationErrors('status_code');
        $post(['from_path' => '/a', 'to_path' => '/A/'])->assertJsonValidationErrors(['to_path' => 'loop back to /a']);
        $post(['from_path' => '/a', 'to_path' => '/b'])->assertCreated();
        $post(['from_path' => '/b', 'to_path' => '/c'])->assertCreated();
        $post(['from_path' => '/c', 'to_path' => '/a'])->assertJsonValidationErrors(['to_path' => 'loop back to /c']);
        $post(['from_path' => '/A', 'to_path' => '/z'])->assertJsonValidationErrors(['from_path' => 'already exists']);
    }

    public function test_redirects_import_from_csv(): void
    {
        UrlRedirect::create(['from_path' => '/old', 'to_path' => '/x', 'status_code' => 301]);
        $csv = "from_path,to_path,status_code\n/old,/new,302\n/sale,https://example.com/sale,\nbad,/x,301\n";
        $this->asAdmin($this->headers, 'POST', '/api/admin/v1/redirects/import', ['file' => UploadedFile::fake()->createWithContent('r.csv', $csv)])
            ->assertOk()->assertJsonPath('data.created', 1)->assertJsonPath('data.updated', 1)
            ->assertJsonPath('data.errors.0.line', 4);
        $this->assertSame(['/new', 302], [UrlRedirect::where('from_path', '/old')->value('to_path'), UrlRedirect::where('from_path', '/old')->value('status_code')]);
    }

    public function test_redirects_need_seo_manage(): void
    {
        $viewer = $this->signInAdmin(Admin::factory()->role('Viewer')->create());
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/redirects')->assertForbidden()->assertJsonPath('permission', 'seo.manage');
        $marketing = $this->signInAdmin(Admin::factory()->role('Marketing')->create());
        $this->asAdmin($marketing, 'GET', '/api/admin/v1/redirects')->assertOk();
    }
}
