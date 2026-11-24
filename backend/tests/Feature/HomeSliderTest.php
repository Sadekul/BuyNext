<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Services\HomeContent;
use App\Services\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** The home page slider: hero_mode, slides, and slider settings (docs/backend/HOME_SLIDER_CONTRACT.md). */
class HomeSliderTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private const BN = ['Accept-Language' => 'bn'];

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->headers = $this->adminHeaders();
    }

    /** A valid PUT body: the stored content (as the admin sends it back) with $changes on top. */
    private function body(array $changes = []): array
    {
        $content = app(HomeContent::class)->get();
        $content['featured_product_ids'] = []; // the test database has none of the seeded ids

        return array_replace($content, $changes);
    }

    private function slide(array $fields = []): array
    {
        return ['title' => 'Slide', 'tone' => 'navy', ...$fields];
    }

    public function test_old_stored_content_gets_the_defaults(): void
    {
        $content = app(HomeContent::class)->get();
        unset($content['hero_mode'], $content['slides'], $content['slider']);
        app(Settings::class)->put([HomeContent::KEY => $content]);

        $admin = $this->asAdmin($this->headers, 'GET', '/api/admin/v1/home')->assertOk()->json('data');
        $this->assertSame('banner', $admin['hero_mode']);
        $this->assertSame([], $admin['slides']);
        $this->assertSame(['autoplay' => true, 'interval_seconds' => 6], $admin['slider']);

        $public = $this->getJson('/api/v1/home')->assertOk()->json('data');
        $this->assertSame('banner', $public['hero_mode']);
        $this->assertSame([], $public['slides']);
        $this->assertSame(['autoplay' => true, 'interval_seconds' => 6], $public['slider']);
    }

    public function test_a_put_without_the_slider_keys_keeps_the_stored_slides(): void
    {
        $service = app(HomeContent::class);
        $content = $service->get();
        $content['hero_mode'] = 'slider';
        $content['slider'] = ['autoplay' => false, 'interval_seconds' => 9];
        $service->save($content);
        $body = $this->body();
        unset($body['hero_mode'], $body['slides'], $body['slider']);

        $data = $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $body)->assertOk()->json('data');
        $this->assertSame('slider', $data['hero_mode']);
        $this->assertSame(['new-season', 'workday-laptops', 'signature-fragrances'], array_column($data['slides'], 'id'), 'leaving out slides never deletes them');
        $this->assertSame(['autoplay' => false, 'interval_seconds' => 9], $data['slider']);
        $this->assertSame('Everything you love, delivered to your nest.', $data['hero']['title']);
    }

    public function test_the_migration_adds_three_demo_slides_with_bangla(): void
    {
        $content = app(HomeContent::class)->get();
        $this->assertSame('banner', $content['hero_mode'], 'the store still shows the single banner');
        $this->assertSame(['new-season', 'workday-laptops', 'signature-fragrances'], array_column($content['slides'], 'id'));
        $this->assertSame([0, 1, 2], array_column($content['slides'], 'position'));
        foreach ($content['slides'] as $slide) {
            $this->assertTrue($slide['is_active']);
            $this->assertStringStartsWith('https://cdn.dummyjson.com/product-images/', $slide['image_url']);
            foreach (['eyebrow', 'title', 'description', 'image_alt', 'primary_cta_label'] as $field) {
                $this->assertNotEmpty($slide['bn'][$field] ?? null, "{$slide['id']}: bn.{$field}");
            }
        }
        $this->assertSame('অফারগুলো দেখুন', $content['slides'][0]['bn']['secondary_cta_label']);

        // Running it again never replaces slides that exist.
        $content['slides'] = [[...$content['slides'][1], 'title' => 'Our own slide']];
        app(HomeContent::class)->save($content);
        $migration = require database_path('migrations/2026_11_24_000300_add_home_slider.php');
        $migration->up();
        $this->assertSame(['Our own slide'], array_column(app(HomeContent::class)->get()['slides'], 'title'));
    }

    public function test_saving_slides_and_the_public_answer(): void
    {
        $body = $this->body([
            'hero_mode' => 'slider',
            'slides' => [
                $this->slide(['title' => 'Third', 'position' => 9, 'tone' => 'amber', 'primary_cta' => ['label' => 'Go', 'url' => 'https://example.com/x'],
                    'bn' => ['title' => 'তৃতীয়', 'description' => '  ', 'primary_cta_label' => 'চলুন']]),
                $this->slide(['id' => 'first', 'title' => ' First ', 'position' => 1, 'description' => 'English text', 'image_url' => 'https://cdn.example.com/a.webp']),
                $this->slide(['id' => 'off', 'title' => 'Off', 'position' => 3, 'is_active' => false]),
                ['title' => 'No tone'], // no position: its index (3), after the earlier slide at 3
            ],
            'slider' => ['autoplay' => false, 'interval_seconds' => 10],
        ]);

        $data = $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $body)->assertOk()->json('data');
        $this->assertSame('slider', $data['hero_mode']);
        $this->assertSame(['First', 'Off', 'No tone', 'Third'], array_column($data['slides'], 'title'));
        $this->assertSame([0, 1, 2, 3], array_column($data['slides'], 'position'));
        $this->assertMatchesRegularExpression('/^slide-[a-z0-9]{8}$/', $data['slides'][2]['id']);
        $this->assertSame('navy', $data['slides'][2]['tone']);
        $this->assertNull($data['slides'][2]['bn']);
        $this->assertEquals(['title' => 'তৃতীয়', 'description' => null, 'primary_cta_label' => 'চলুন', 'eyebrow' => null, 'secondary_cta_label' => null, 'image_alt' => null],
            $data['slides'][3]['bn']);
        $this->assertSame(['autoplay' => false, 'interval_seconds' => 10], $data['slider']);
        $this->assertNotNull($data['hero'], 'the single banner is kept in slider mode');

        // Public: active slides only, by position, no `bn`.
        $public = $this->getJson('/api/v1/home')->assertOk()->json('data');
        $this->assertSame('slider', $public['hero_mode']);
        $this->assertSame(['First', 'No tone', 'Third'], array_column($public['slides'], 'title'));
        $this->assertArrayNotHasKey('bn', $public['slides'][0]);
        $this->assertSame(['autoplay' => false, 'interval_seconds' => 10], $public['slider']);

        // Bangla per field: filled fields replace the English, empty ones keep it.
        $bangla = $this->getJson('/api/v1/home', self::BN)->assertOk()->json('data');
        $third = $bangla['slides'][2];
        $this->assertSame('তৃতীয়', $third['title']);
        $this->assertEquals(['label' => 'চলুন', 'url' => 'https://example.com/x'], $third['primary_cta']); // MySQL JSON keeps its own key order
        $this->assertSame('English text', $bangla['slides'][0]['description']);
        $this->assertArrayNotHasKey('bn', $third);
    }

    public function test_slider_mode_without_an_active_slide_shows_the_banner(): void
    {
        // Stored directly (the API refuses it), as content saved before slides were switched off would be.
        $content = app(HomeContent::class)->get();
        $content['hero_mode'] = 'slider';
        $content['slides'] = array_map(fn ($slide) => [...$slide, 'is_active' => false], $content['slides']);
        app(HomeContent::class)->save($content);

        $public = $this->getJson('/api/v1/home')->assertOk()->json('data');
        $this->assertSame('banner', $public['hero_mode']);
        $this->assertSame([], $public['slides']);
        $this->assertSame('slider', $this->asAdmin($this->headers, 'GET', '/api/admin/v1/home')->json('data.hero_mode'));
    }

    public function test_slider_validation(): void
    {
        $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $this->body([
            'hero_mode' => 'carousel',
            'slides' => [
                $this->slide(['title' => '', 'primary_cta' => ['label' => 'x', 'url' => 'javascript:alert(1)'], 'secondary_cta' => ['label' => 'y', 'url' => '//evil.example'],
                    'image_url' => 'ftp://x', 'tone' => 'purple', 'id' => 'Bad Id']),
            ],
            'slider' => ['autoplay' => 'yes', 'interval_seconds' => 2],
        ]))->assertUnprocessable()->assertJsonValidationErrors([
            'hero_mode', 'slides.0.title', 'slides.0.primary_cta.url', 'slides.0.secondary_cta.url', 'slides.0.image_url',
            'slides.0.tone', 'slides.0.id', 'slider.autoplay', 'slider.interval_seconds',
        ])->assertJsonPath('errors', fn ($errors) => $errors['slides.0.primary_cta.url'] === ['A link must start with / (a page of this shop) or https://.']
            && $errors['slider.interval_seconds'] === ['Show each slide for 3 to 15 seconds.']);

        $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $this->body(['slider' => ['autoplay' => true, 'interval_seconds' => 16]]))
            ->assertUnprocessable()->assertJsonValidationErrors(['slider.interval_seconds']);
        $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $this->body(['slider' => ['autoplay' => true, 'interval_seconds' => 15]]))->assertOk();
        $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $this->body(['slider' => ['autoplay' => true, 'interval_seconds' => 3]]))->assertOk();

        // At most 8 slides.
        $nine = array_map(fn ($i) => $this->slide(['title' => "S{$i}"]), range(1, 9));
        $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $this->body(['slides' => $nine]))
            ->assertUnprocessable()->assertJsonValidationErrors(['slides' => 'The slider has at most 8 slides.']);
        $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $this->body(['slides' => array_slice($nine, 0, 8)]))->assertOk();

        // Distinct ids.
        $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $this->body(['slides' => [$this->slide(['id' => 'a']), $this->slide(['id' => 'a'])]]))
            ->assertUnprocessable()->assertJsonValidationErrors(['slides.0.id', 'slides.1.id']);
    }

    public function test_slider_mode_needs_an_active_slide(): void
    {
        $message = 'Add at least one active slide, or show the single banner instead.';
        foreach ([[], [$this->slide(['is_active' => false]), $this->slide(['is_active' => '0'])]] as $slides) {
            $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $this->body(['hero_mode' => 'slider', 'slides' => $slides]))
                ->assertUnprocessable()->assertJsonValidationErrors(['slides' => $message]);
        }
        // Slides left out: the stored (active demo) slides are kept, so slider mode is fine.
        $body = $this->body(['hero_mode' => 'slider']);
        unset($body['slides']);
        $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $body)->assertOk()->assertJsonPath('data.hero_mode', 'slider');

        // Banner mode may keep no slides, or only hidden ones; slider mode with one active slide is fine.
        $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $this->body(['hero_mode' => 'banner', 'slides' => [$this->slide(['is_active' => false])]]))->assertOk();
        $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $this->body(['hero_mode' => 'slider', 'slides' => [$this->slide(['is_active' => false]), $this->slide()]]))->assertOk();
    }

    public function test_saving_the_slider_is_audited(): void
    {
        $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $this->body())->assertOk(); // stored in the saved shape first
        $this->asAdmin($this->headers, 'PUT', '/api/admin/v1/home', $this->body(['hero_mode' => 'slider', 'slider' => ['autoplay' => false, 'interval_seconds' => 8]]))->assertOk();

        $log = AuditLog::where('action', 'home.updated')->latest('id')->firstOrFail();
        $this->assertEqualsCanonicalizing(['hero_mode', 'slider'], array_keys($log->changes['after']));
        $this->assertSame('banner', $log->changes['before']['hero_mode']);
        $this->assertSame('slider', $log->changes['after']['hero_mode']);
    }
}
