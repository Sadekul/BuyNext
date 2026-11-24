<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\CategoryTranslation;
use App\Services\HomeContent;
use Database\Seeders\BanglaDemoContentSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Bangla drafts for the demo store's own content: filled only where empty and still the demo text. */
class BanglaDemoContentTest extends TestCase
{
    use RefreshDatabase;

    private const BN = ['Accept-Language' => 'bn'];

    public function test_demo_categories_get_bangla_names_and_staff_names_stay(): void
    {
        $laptops = Category::factory()->create(['slug' => 'laptops', 'name' => 'Laptops']);
        $beauty = Category::factory()->create(['slug' => 'beauty', 'name' => 'Beauty']);
        $own = Category::factory()->create(['slug' => 'garden', 'name' => 'Garden']);
        CategoryTranslation::create(['category_id' => $beauty->id, 'locale' => 'bn', 'name' => 'রূপচর্চা']);

        (new BanglaDemoContentSeeder)->run();
        (new BanglaDemoContentSeeder)->run();

        $this->assertSame('ল্যাপটপ', CategoryTranslation::where(['category_id' => $laptops->id, 'locale' => 'bn'])->value('name'));
        $this->assertSame('রূপচর্চা', CategoryTranslation::where(['category_id' => $beauty->id, 'locale' => 'bn'])->value('name'));
        $this->assertFalse(CategoryTranslation::where('category_id', $own->id)->exists());
        $this->assertSame(1, CategoryTranslation::where(['category_id' => $laptops->id, 'locale' => 'bn'])->count());
        $this->assertCount(24, BanglaDemoContentSeeder::CATEGORIES);
    }

    public function test_the_demo_home_content_is_bangla_in_bangla(): void
    {
        // The migration already ran the seeder on the seeded demo home content.
        $home = $this->getJson('/api/v1/home', self::BN)->assertOk()->json('data');
        $this->assertSame('আপনার পছন্দের সবকিছু, পৌঁছে যাবে আপনার দোরগোড়ায়।', $home['hero']['title']);
        $this->assertSame('এখনই কিনুন', $home['hero']['primary_cta']['label']);
        $this->assertSame(['$৫০-এর বেশি অর্ডারে ফ্রি শিপিং', '৩০ দিনের মধ্যে রিটার্ন', 'নিরাপদ চেকআউট'], $home['hero']['highlights']);
        $this->assertSame(['যেকোনো জায়গা থেকে কাজ করুন', 'খুঁজে নিন আপনার নিজস্ব সুবাস'], array_column($home['banners'], 'title'));
        $this->assertSame('ল্যাপটপ দেখুন', $home['banners'][0]['cta']['label']);

        $english = $this->getJson('/api/v1/home')->assertOk()->json('data');
        $this->assertSame('Everything you love, delivered to your nest.', $english['hero']['title']);
        $this->assertSame('Work from anywhere', $english['banners'][0]['title']);
    }

    public function test_texts_staff_changed_or_translated_are_left_alone(): void
    {
        $service = app(HomeContent::class);
        $content = $service->get();
        $content['hero']['title'] = 'Our own headline';
        $content['hero']['highlights'] = ['Free shipping over $50', 'Cash on delivery'];
        $content['hero']['bn'] = ['eyebrow' => 'আমাদের নিজের লেখা'];
        $content['banners'][0]['bn'] = [];
        $service->save($content);

        (new BanglaDemoContentSeeder)->run();

        $bn = $service->get()['hero']['bn'];
        $this->assertSame('আমাদের নিজের লেখা', $bn['eyebrow'], 'a Bangla text staff wrote stays');
        $this->assertArrayNotHasKey('title', $bn, 'a changed English headline gets no guessed Bangla');
        $this->assertArrayNotHasKey('highlights', $bn, 'highlights with a non-demo item are left for staff');
        $this->assertSame('এখনই কিনুন', $bn['primary_cta_label']);
        $this->assertSame('যেকোনো জায়গা থেকে কাজ করুন', $service->get()['banners'][0]['bn']['title']);
    }
}
