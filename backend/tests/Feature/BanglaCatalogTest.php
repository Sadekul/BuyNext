<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Page;
use App\Models\Product;
use App\Services\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 13: Bangla content (products, categories, pages, home, options, specifications), search, locales, and the admin side. */
class BanglaCatalogTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private const BN = ['Accept-Language' => 'bn'];

    private array $admin;

    private Category $category;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
        $this->category = Category::factory()->create(['name' => 'Gadgets', 'slug' => 'gadgets', 'description' => 'Useful things']);
    }

    private function admin(string $method, string $uri, array $body = []): TestResponse
    {
        return $this->asAdmin($this->admin, $method, $uri, $body);
    }

    private function headphones(): Product
    {
        return $this->product(['name' => 'Wireless Headphones', 'description' => 'Great sound.', 'category_id' => $this->category->id,
            'meta_title' => 'Headphones SEO', 'specifications' => [['label' => 'Battery', 'value' => '20 h', 'label_bn' => 'ব্যাটারি']]]);
    }

    public function test_store_rules_list_the_languages_and_settings_change_them(): void
    {
        $this->getJson('/api/v1/store')->assertOk()
            ->assertJsonPath('data.locales', ['en', 'bn'])->assertJsonPath('data.default_locale', 'en')->assertJsonPath('data.bangla_digits', true);

        $this->admin('PATCH', '/api/admin/v1/settings', ['general' => ['default_locale' => 'fr']])
            ->assertUnprocessable()->assertJsonValidationErrors('general.default_locale');
        $this->admin('PATCH', '/api/admin/v1/settings', ['general' => ['default_locale' => 'bn', 'bangla_digits' => false]])->assertOk()
            ->assertJsonPath('data.general.default_locale', 'bn')->assertJsonPath('data.general.bangla_digits', false);

        // No (usable) language asked for → the store default, now Bangla; admin routes stay English.
        $this->getJson('/api/v1/store', ['Accept-Language' => ''])->assertOk()->assertHeader('Content-Language', 'bn')
            ->assertJsonPath('data.default_locale', 'bn')->assertJsonPath('data.bangla_digits', false);
        $this->getJson('/api/v1/store', ['Accept-Language' => 'fr-FR'])->assertHeader('Content-Language', 'bn');
        $this->getJson('/api/v1/store', ['Accept-Language' => 'en'])->assertHeader('Content-Language', 'en');
        $this->admin('GET', '/api/admin/v1/settings')->assertOk()->assertHeader('Content-Language', 'en');
    }

    public function test_customers_save_their_language(): void
    {
        $customer = Customer::factory()->create();
        $this->app['auth']->forgetGuards();
        $headers = ['Authorization' => 'Bearer '.$this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])
            ->assertOk()->json('data.tokens.access_token')];

        $this->getJson('/api/v1/me', $headers)->assertOk()->assertJsonPath('data.locale', null);
        $this->patchJson('/api/v1/me', ['locale' => 'de'], $headers)->assertUnprocessable()->assertJsonValidationErrors('locale');
        $this->patchJson('/api/v1/me', ['locale' => 'bn'], $headers)->assertOk()->assertJsonPath('data.locale', 'bn');
        $this->assertSame('bn', $customer->fresh()->locale);
        $this->patchJson('/api/v1/me', ['locale' => null], $headers)->assertOk()->assertJsonPath('data.locale', null);

        // Staff see and change it.
        $this->admin('PATCH', "/api/admin/v1/customers/{$customer->id}", ['locale' => 'bn'])->assertOk();
        $this->admin('GET', "/api/admin/v1/customers/{$customer->id}")->assertOk()->assertJsonPath('data.locale', 'bn');
    }

    public function test_products_answer_in_bangla_with_per_field_fallback(): void
    {
        $product = $this->headphones();
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['translations' => ['bn' => [
            'name' => 'ওয়্যারলেস হেডফোন', 'short_description' => 'চমৎকার শব্দ', 'description' => null,
        ]]])->assertOk()
            ->assertJsonPath('data.name', 'Wireless Headphones')
            ->assertJsonPath('data.translations.bn.name', 'ওয়্যারলেস হেডফোন')
            ->assertJsonPath('data.translations.bn.description', null)
            ->assertJsonPath('data.bangla', ['complete' => false, 'missing' => ['description', 'meta_title', 'meta_description']])
            ->assertJsonPath('data.bangla_complete', false)
            ->assertJsonPath('data.specifications.0', ['label' => 'Battery', 'value' => '20 h', 'label_bn' => 'ব্যাটারি', 'value_bn' => null]);
        $this->category->saveTranslation('bn', ['name' => 'গ্যাজেট']);

        $this->getJson("/api/v1/products/{$product->id}", self::BN)->assertOk()
            ->assertJsonPath('data.name', 'ওয়্যারলেস হেডফোন')
            ->assertJsonPath('data.locale', 'bn')
            ->assertJsonPath('data.short_description', 'চমৎকার শব্দ')
            ->assertJsonPath('data.description', 'Great sound.') // no Bangla description: English
            ->assertJsonPath('data.meta_title', 'Headphones SEO')
            ->assertJsonPath('data.category.name', 'গ্যাজেট')
            ->assertJsonPath('data.specifications', [['label' => 'ব্যাটারি', 'value' => '20 h']]);
        $this->getJson("/api/v1/products/{$product->id}")->assertOk()
            ->assertJsonPath('data.name', 'Wireless Headphones')->assertJsonPath('data.locale', 'en')
            ->assertJsonPath('data.short_description', null)->assertJsonPath('data.category.name', 'Gadgets')
            ->assertJsonPath('data.specifications', [['label' => 'Battery', 'value' => '20 h']]);
        $this->getJson('/api/v1/products', self::BN)->assertOk()->assertJsonPath('data.0.name', 'ওয়্যারলেস হেডফোন');

        // An untranslated product says so.
        $plain = $this->product(['name' => 'Desk Lamp', 'category_id' => $this->category->id]);
        $this->getJson("/api/v1/products/{$plain->id}", self::BN)->assertJsonPath('data.name', 'Desk Lamp')->assertJsonPath('data.locale', 'en');

        // Complete: name + description; the grid filter finds both kinds.
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['translations' => ['bn' => ['description' => 'দারুণ শব্দ।']]])
            ->assertOk()->assertJsonPath('data.bangla.complete', true)->assertJsonPath('data.translations.bn.name', 'ওয়্যারলেস হেডফোন');
        $this->assertSame([$product->id], array_column($this->admin('GET', '/api/admin/v1/products?bangla=complete')->assertOk()->json('data'), 'id'));
        $this->assertSame([$plain->id], array_column($this->admin('GET', '/api/admin/v1/products?bangla=missing')->assertOk()->json('data'), 'id'));
        $this->admin('GET', '/api/admin/v1/products?bangla=maybe')->assertUnprocessable();

        // Duplicates keep the Bangla text; clearing every field removes the row.
        $copy = $this->admin('POST', "/api/admin/v1/products/{$product->id}/duplicate")->assertCreated()->json('data.id');
        $this->assertSame('ওয়্যারলেস হেডফোন', Product::find($copy)->translationFields('bn')['name']);
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['translations' => ['bn' => [
            'name' => '', 'short_description' => null, 'description' => null,
        ]]])->assertOk()->assertJsonPath('data.translations.bn.name', null);
        $this->assertSame(0, $product->translations()->count());
        $this->assertTrue(AuditLog::where('action', 'product.translated')->where('subject_id', $product->id)->exists());

        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['translations' => ['fr' => ['name' => 'x']]])->assertUnprocessable();
        $this->admin('PATCH', "/api/admin/v1/products/{$product->id}", ['translations' => ['bn' => ['name' => str_repeat('অ', 121)]]])
            ->assertUnprocessable()->assertJsonValidationErrors('translations.bn.name');
    }

    public function test_options_and_values_have_bangla_names(): void
    {
        $shirt = $this->product(['name' => 'Shirt', 'category_id' => $this->category->id]);
        $this->admin('PUT', "/api/admin/v1/products/{$shirt->id}/options", ['options' => [
            ['name' => 'Size', 'name_bn' => 'সাইজ', 'values' => ['S', 'M']],
            ['name' => 'Color', 'values' => ['Blue'], 'values_bn' => ['নীল']],
        ]])->assertOk()
            ->assertJsonPath('data.options.0.name_bn', 'সাইজ')
            ->assertJsonPath('data.options.0.values.0.value_bn', null)
            ->assertJsonPath('data.options.1.values.0.value_bn', 'নীল');
        $this->admin('POST', "/api/admin/v1/products/{$shirt->id}/variants/generate")->assertOk();

        $bn = $this->getJson("/api/v1/products/{$shirt->id}", self::BN)->assertOk();
        $bn->assertJsonPath('data.options.0.name', 'সাইজ')->assertJsonPath('data.options.0.values.0.value', 'S')
            ->assertJsonPath('data.options.1.name', 'Color')->assertJsonPath('data.options.1.values.0.value', 'নীল');
        $this->getJson("/api/v1/products/{$shirt->id}")->assertJsonPath('data.options.0.name', 'Size')->assertJsonPath('data.options.1.values.0.value', 'Blue');

        // Sent again without Bangla keys: the saved Bangla stays.
        $this->admin('PUT', "/api/admin/v1/products/{$shirt->id}/options", ['options' => [
            ['name' => 'Size', 'values' => ['S', 'M']], ['name' => 'Color', 'values' => ['Blue']],
        ]])->assertOk()->assertJsonPath('data.options.0.name_bn', 'সাইজ')->assertJsonPath('data.options.1.values.0.value_bn', 'নীল');
    }

    public function test_categories_pages_and_home_in_bangla(): void
    {
        $this->product(['category_id' => $this->category->id]);
        $this->admin('PATCH', "/api/admin/v1/categories/{$this->category->id}", ['translations' => ['bn' => ['name' => 'গ্যাজেট']]])
            ->assertOk()->assertJsonPath('data.translations.bn.name', 'গ্যাজেট')
            ->assertJsonPath('data.bangla', ['complete' => false, 'missing' => ['description', 'meta_title', 'meta_description']]);
        $this->getJson('/api/v1/categories', self::BN)->assertOk()
            ->assertJsonPath('data.0.name', 'গ্যাজেট')->assertJsonPath('data.0.locale', 'bn')->assertJsonPath('data.0.description', 'Useful things');
        $this->getJson('/api/v1/categories')->assertJsonPath('data.0.name', 'Gadgets')->assertJsonPath('data.0.locale', 'en');

        $page = $this->admin('POST', '/api/admin/v1/pages', ['slug' => 'faq', 'title' => 'FAQ', 'body' => '<p>Answers</p>',
            'translations' => ['bn' => ['title' => 'সাধারণ প্রশ্ন', 'body' => '<p>উত্তর</p><script>x</script>']]])
            ->assertCreated()->assertJsonPath('data.translations.bn.title', 'সাধারণ প্রশ্ন')->assertJsonPath('data.bangla.complete', true)->json('data');
        $this->assertStringNotContainsString('script', $page['translations']['bn']['body']);
        $this->getJson('/api/v1/pages/faq', self::BN)->assertOk()
            ->assertJsonPath('data.title', 'সাধারণ প্রশ্ন')->assertJsonPath('data.body', '<p>উত্তর</p>')->assertJsonPath('data.locale', 'bn')
            ->assertJsonMissingPath('data.translations');
        $this->getJson('/api/v1/pages/faq')->assertJsonPath('data.title', 'FAQ')->assertJsonPath('data.locale', 'en');
        $this->getJson('/api/v1/pages/nope', self::BN)->assertNotFound();

        $this->admin('PUT', '/api/admin/v1/home', [
            'hero' => ['title' => 'Big sale', 'primary_cta' => ['label' => 'Shop', 'url' => '/products'],
                'bn' => ['title' => 'বড় সেল', 'primary_cta_label' => 'কিনুন']],
            'banners' => [['id' => 'one', 'title' => 'New', 'tone' => 'rose', 'bn' => ['title' => 'নতুন']]],
            'featured_product_ids' => [],
        ])->assertOk()->assertJsonPath('data.hero.bn.title', 'বড় সেল');
        $this->getJson('/api/v1/home', self::BN)->assertOk()
            ->assertJsonPath('data.hero.title', 'বড় সেল')->assertJsonPath('data.hero.primary_cta.label', 'কিনুন')
            ->assertJsonPath('data.banners.0.title', 'নতুন')->assertJsonMissingPath('data.hero.bn')->assertJsonMissingPath('data.banners.0.bn');
        $this->getJson('/api/v1/home')->assertJsonPath('data.hero.title', 'Big sale')->assertJsonPath('data.banners.0.title', 'New');
    }

    public function test_search_finds_bangla_names_and_never_corrects_bangla_words(): void
    {
        $product = $this->headphones();
        $product->saveTranslation('bn', ['name' => 'ওয়্যারলেস হেডফোন', 'description' => 'দারুণ শব্দের হেডফোন']);
        $this->product(['name' => 'Desk Lamp', 'category_id' => $this->category->id]);

        foreach (['হেডফোন', 'শব্দের'] as $query) {
            $this->getJson('/api/v1/products?search='.urlencode($query), self::BN)->assertOk()
                ->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $product->id)->assertJsonPath('meta.corrected_query', null);
        }
        // Also from the English store, and English words still work in Bangla.
        $this->getJson('/api/v1/products?search='.urlencode('হেডফোন'))->assertJsonPath('meta.total', 1);
        $this->getJson('/api/v1/products?search=headphones', self::BN)->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.name', 'ওয়্যারলেস হেডফোন');
        // A Bangla typo isn't "corrected" to an English word.
        $this->getJson('/api/v1/products?search='.urlencode('হেডফন'), self::BN)->assertOk()
            ->assertJsonPath('meta.total', 0)->assertJsonPath('meta.corrected_query', null);
    }

    public function test_the_cart_shows_bangla_names_but_orders_keep_english_snapshots(): void
    {
        $shirt = $this->product(['name' => 'Shirt', 'category_id' => $this->category->id, 'price' => '10.00', 'stock_quantity' => 10]);
        $shirt->saveTranslation('bn', ['name' => 'শার্ট']);
        $this->admin('PUT', "/api/admin/v1/products/{$shirt->id}/options", ['options' => [
            ['name' => 'Size', 'name_bn' => 'সাইজ', 'values' => ['M'], 'values_bn' => ['মাঝারি']],
        ]])->assertOk();
        $this->admin('POST', "/api/admin/v1/products/{$shirt->id}/variants/generate")->assertOk();
        $variant = $shirt->fresh()->variants()->first();
        $variant->update(['stock_quantity' => 5, 'is_active' => true]);
        $shirt->fresh()->syncVariantStock();
        $item = ['product_id' => $shirt->id, 'variant_id' => $variant->id, 'quantity' => 1];

        $this->postJson('/api/v1/cart/validate', ['items' => [$item]], self::BN)->assertOk()
            ->assertJsonPath('data.lines.0.name', 'শার্ট')->assertJsonPath('data.lines.0.variant_label', 'সাইজ: মাঝারি');
        $this->postJson('/api/v1/cart/validate', ['items' => [$item]])->assertOk()
            ->assertJsonPath('data.lines.0.name', 'Shirt')->assertJsonPath('data.lines.0.variant_label', 'Size: M');

        $number = $this->placeOrder([$item], [], self::BN)->assertCreated()->json('data.number');
        $line = Order::where('number', $number)->first()->items()->first();
        $this->assertSame(['Shirt', 'Size: M'], [$line->name, $line->variant_label]);
    }

    public function test_orders_record_the_language_they_were_placed_in(): void
    {
        $product = $this->product(['price' => '10.00', 'stock_quantity' => 10]);
        $bn = $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]], [], self::BN)->assertCreated()
            ->assertJsonPath('data.locale', 'bn')->json('data.number');
        $en = $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]])->assertCreated()->assertJsonPath('data.locale', 'en')->json('data.number');
        $this->assertSame(['bn', 'en'], [Order::where('number', $bn)->value('locale'), Order::where('number', $en)->value('locale')]);
        $this->admin('GET', "/api/admin/v1/orders/{$bn}")->assertOk()->assertJsonPath('data.locale', 'bn');

        // Store default Bangla: an order without a usable language is Bangla too.
        app(Settings::class)->put(['default_locale' => 'bn']);
        $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]], [], ['Accept-Language' => ''])->assertCreated()->assertJsonPath('data.locale', 'bn');
    }

    public function test_csv_exports_and_imports_the_bangla_columns(): void
    {
        $product = $this->product(['sku' => 'HP-1', 'name' => 'Headphones', 'category_id' => $this->category->id]);
        $product->saveTranslation('bn', ['name' => 'হেডফোন', 'meta_title' => 'হেডফোন কিনুন']);

        $this->app['auth']->forgetGuards();
        $csv = $this->get('/api/admin/v1/products/export.csv', $this->admin)->assertOk()->getContent();
        $lines = array_map(fn ($line) => str_getcsv($line, escape: ''), array_filter(explode("\n", trim($csv))));
        $this->assertSame(['name_bn', 'short_description_bn', 'description_bn', 'meta_title_bn', 'meta_description_bn'], array_slice($lines[0], -5));
        $this->assertSame(['হেডফোন', '', '', 'হেডফোন কিনুন', ''], array_slice($lines[1], -5));

        $import = function (string $csv, bool $dryRun) {
            $this->app['auth']->forgetGuards();

            return $this->post('/api/admin/v1/products/import', [
                'file' => UploadedFile::fake()->createWithContent('p.csv', $csv), 'dry_run' => $dryRun ? '1' : '0',
            ], $this->admin);
        };
        $file = "sku,name,category_slug,price,stock_quantity,name_bn,description_bn\n"
            ."HP-1,Headphones,gadgets,10,5,হেডফোন,দারুণ শব্দ\n"
            .'NEW-1,Lamp,gadgets,5,1,বাতি,';
        $import($file, true)->assertOk()->assertJsonPath('data.errors', []);
        $import($file, false)->assertOk()->assertJsonPath('data.errors', []);
        $this->assertSame('দারুণ শব্দ', $product->fresh()->translationFields('bn')['description']);
        $this->assertSame('হেডফোন কিনুন', $product->fresh()->translationFields('bn')['meta_title']); // empty/missing cell: unchanged
        $this->assertSame('বাতি', Product::where('sku', 'NEW-1')->first()->translationFields('bn')['name']);

        $import("sku,name,name_bn\nHP-1,Headphones,".str_repeat('অ', 121), true)->assertOk()->assertJsonPath('data.errors.0.column', 'name_bn');
    }

    public function test_page_translations_are_removed_with_the_page(): void
    {
        $page = Page::create(['slug' => 'x', 'title' => 'X', 'body' => '<p>x</p>', 'is_published' => true]);
        $page->saveTranslation('bn', ['title' => 'এক্স']);
        $this->admin('DELETE', "/api/admin/v1/pages/{$page->id}")->assertNoContent();
        $this->assertDatabaseCount('page_translations', 0);
    }
}
