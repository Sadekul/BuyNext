<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Page;
use App\Services\HtmlSanitizer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Content pages (sanitized HTML), the home page content, and their public endpoints. */
class ContentTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->headers = $this->adminHeaders();
    }

    private function clean(string $html): string
    {
        return app(HtmlSanitizer::class)->clean($html);
    }

    public function test_the_sanitizer_removes_scripts_and_their_content(): void
    {
        $this->assertSame('<p>Hello</p>', $this->clean('<p>Hello<script>alert(1)</script></p>'));
        $this->assertSame('<p>Hi</p>', $this->clean('<SCRIPT SRC=//evil.example/x.js></SCRIPT><p>Hi</p>'));
    }

    public function test_the_sanitizer_removes_event_attributes(): void
    {
        $this->assertSame('<p>Click</p>', $this->clean('<p onclick="steal()" onmouseover=alert(1)>Click</p>'));
        $this->assertSame('', $this->clean('<img src=x onerror=alert(1)>'));
        $this->assertStringNotContainsString('onload', $this->clean('<svg onload=alert(1)><p>x</p></svg>'));
    }

    public function test_the_sanitizer_removes_javascript_and_data_links(): void
    {
        foreach (['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java&#x09;script:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x'] as $href) {
            $html = $this->clean('<a href="'.$href.'">x</a>');
            $this->assertStringNotContainsString('href', $html, $href);
            $this->assertStringNotContainsStringIgnoringCase('script', $html, $href);
        }
    }

    public function test_the_sanitizer_removes_iframes_styles_and_style_attributes(): void
    {
        $this->assertSame('<p>After</p>', $this->clean('<iframe src="https://evil.example"></iframe><p>After</p>'));
        $this->assertSame('<p>Text</p>', $this->clean('<style>body{display:none}</style><p>Text</p>'));
        $this->assertSame('<p>Red</p>', $this->clean('<p style="color:red;background:url(javascript:x)">Red</p>'));
        $this->assertSame('', $this->clean('<object data="x.swf"></object><embed src="x"><form action="/x"><input name="a"></form>'));
    }

    public function test_the_sanitizer_keeps_the_allowed_tags_and_sets_noopener_on_links(): void
    {
        $html = '<h2>Title</h2><h3>Sub</h3><h4>Small</h4><p><strong>Bold</strong> <em>it</em><br></p><ul><li>One</li></ul><ol><li>Two</li></ol>'
            .'<blockquote>Quote</blockquote><hr><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>';
        $this->assertSame(str_replace(['<br>', '<hr>'], ['<br />', '<hr />'], $html), $this->clean($html));

        $this->assertSame('<a href="https://example.com" rel="noopener">x</a>', $this->clean('<a href="https://example.com" target="_blank" rel="opener">x</a>'));
        $this->assertSame('<a href="/pages/about" rel="noopener">x</a>', $this->clean('<a href="/pages/about">x</a>'));
        $this->assertStringContainsString('href="mailto:', $this->clean('<a href="mailto:help@example.com">x</a>'));
        // Harmless wrappers go, their text stays.
        $this->assertSame('<p>Kept</p>', $this->clean('<div><p><span>Kept</span></p></div>'));
    }

    public function test_pages_are_sanitized_when_saved(): void
    {
        $id = $this->asAdmin($this->headers, 'POST', '/api/admin/v1/pages', [
            'slug' => 'gift-cards', 'title' => 'Gift cards',
            'body' => '<p onclick="x()">Buy one</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>',
            'is_published' => false,
        ])->assertCreated()
            ->assertJsonPath('data.body', '<p>Buy one</p><a rel="noopener">bad</a>')
            ->assertJsonPath('data.is_published', false)
            ->json('data.id');

        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/pages/{$id}", ['body' => '<p>New <iframe src="https://e.example"></iframe></p>'])
            ->assertOk()->assertJsonPath('data.body', '<p>New </p>');
        $this->assertSame('<p>New </p>', Page::find($id)->body);
    }

    public function test_page_validation(): void
    {
        foreach (['About Us', 'about_us', '-about', 'about--us', 'ABOUT'] as $slug) {
            $response = $this->asAdmin($this->headers, 'POST', '/api/admin/v1/pages', ['slug' => $slug, 'title' => 'X', 'body' => '<p>x</p>']);
            if ($slug === 'ABOUT') {
                $response->assertUnprocessable()->assertJsonPath('errors.slug.0', 'Another page already uses this address.'); // lower-cased, then taken
            } else {
                $response->assertUnprocessable()->assertJsonValidationErrors('slug');
            }
        }
        $this->asAdmin($this->headers, 'POST', '/api/admin/v1/pages', ['slug' => 'new'])->assertJsonValidationErrors(['title', 'body']);
    }

    public function test_the_seeded_pages_and_the_public_endpoint(): void
    {
        $slugs = $this->asAdmin($this->headers, 'GET', '/api/admin/v1/pages')->assertOk()->json('data.*.slug');
        sort($slugs);
        $this->assertSame(['about', 'contact', 'privacy', 'shipping-and-returns', 'terms'], $slugs);

        $this->getJson('/api/v1/pages/about')->assertOk()
            ->assertJsonPath('data.title', 'About BuyNest')
            ->assertJsonPath('data.slug', 'about')
            ->assertJsonMissingPath('data.id')
            ->assertJsonMissingPath('data.is_published');

        Page::where('slug', 'terms')->update(['is_published' => false]);
        $this->getJson('/api/v1/pages/terms')->assertNotFound();
        $this->getJson('/api/v1/pages/nope')->assertNotFound();

        $id = Page::where('slug', 'privacy')->value('id');
        $this->asAdmin($this->headers, 'DELETE', "/api/admin/v1/pages/{$id}")->assertNoContent();
        $this->getJson('/api/v1/pages/privacy')->assertNotFound();
    }

    public function test_the_seeded_home_content(): void
    {
        $home = $this->getJson('/api/v1/home')->assertOk()->json('data');

        $this->assertSame('Everything you love, delivered to your nest.', $home['hero']['title']);
        $this->assertEquals(['label' => 'Shop now', 'url' => '/products'], $home['hero']['primary_cta']);
        $this->assertEquals(['label' => 'Explore deals', 'url' => '/deals'], $home['hero']['secondary_cta']);
        $this->assertCount(3, $home['hero']['highlights']);
        $this->assertSame(['work-anywhere', 'signature-scents'], array_column($home['banners'], 'id'));
        $this->assertSame('/categories/laptops', $home['banners'][0]['cta']['url']);
        $this->assertSame([], $home['featured_products']); // the test database has none of the seeded ids
    }

    public function test_editing_the_home_page(): void
    {
        $active = $this->product(['name' => 'Shown']);
        $draft = $this->product(['name' => 'Hidden', 'status' => 'draft']);
        $body = [
            'hero' => [
                'eyebrow' => 'Sale', 'title' => 'Big sale', 'description' => null,
                'primary_cta' => ['label' => 'Shop', 'url' => '/products'], 'secondary_cta' => null,
                'image_url' => 'https://cdn.example.com/hero.webp', 'image_alt' => 'Hero', 'highlights' => ['A', 'B', 'C'],
            ],
            'banners' => [
                ['title' => 'Second', 'tone' => 'amber', 'position' => 5, 'cta' => ['label' => 'Go', 'url' => 'https://example.com/x']],
                ['id' => 'first', 'title' => 'First', 'tone' => 'rose', 'position' => 1],
                ['id' => 'off', 'title' => 'Off', 'tone' => 'navy', 'position' => 3, 'is_active' => false],
            ],
            'featured_product_ids' => [$draft->id, $active->id],
        ];

        $data = $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $body)->assertOk()->json('data');
        $this->assertSame(['first', 'off'], [$data['banners'][0]['id'], $data['banners'][1]['id']]);
        $this->assertSame([0, 1, 2], array_column($data['banners'], 'position'));
        $this->assertMatchesRegularExpression('/^banner-[a-z0-9]{8}$/', $data['banners'][2]['id']);
        $this->assertSame(['Hidden', 'Shown'], array_column($data['featured_products'], 'name'));

        $this->asAdmin($this->headers, 'GET', '/api/admin/v1/home')->assertOk()->assertJsonPath('data.featured_product_ids', [$draft->id, $active->id]);

        $public = $this->getJson('/api/v1/home')->assertOk()->json('data');
        $this->assertSame(['First', 'Second'], array_column($public['banners'], 'title'));
        $this->assertSame(['Shown'], array_column($public['featured_products'], 'name'));
        $this->assertArrayHasKey('sale_price', $public['featured_products'][0]); // a ProductResource
    }

    public function test_home_page_validation(): void
    {
        $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', [
            'hero' => ['title' => '', 'primary_cta' => ['label' => 'x', 'url' => 'javascript:alert(1)'], 'secondary_cta' => ['label' => 'y', 'url' => '//evil.example'],
                'image_url' => 'javascript:alert(1)', 'highlights' => ['1', '2', '3', '4']],
            'banners' => [['title' => 'B', 'tone' => 'purple']],
            'featured_product_ids' => [1, 2, 3, 4, 5, 6, 7, 8, 9],
        ])->assertUnprocessable()->assertJsonValidationErrors([
            'hero.title', 'hero.primary_cta.url', 'hero.secondary_cta.url', 'hero.image_url', 'hero.highlights',
            'banners.0.tone', 'featured_product_ids',
        ]);
    }

    public function test_content_permissions(): void
    {
        $marketing = $this->signInAdmin(Admin::factory()->role('Marketing')->create());
        $this->asAdmin($marketing, 'GET', '/api/admin/v1/home')->assertOk();
        $this->asAdmin($marketing, 'POST', '/api/admin/v1/pages', ['slug' => 'x', 'title' => 'X', 'body' => '<p>x</p>'])->assertCreated();

        $sales = $this->signInAdmin(Admin::factory()->role('Sales staff')->create());
        $this->asAdmin($sales, 'PUT', '/api/admin/v1/home', [])->assertForbidden()->assertJsonPath('permission', 'content.edit');
    }
}
