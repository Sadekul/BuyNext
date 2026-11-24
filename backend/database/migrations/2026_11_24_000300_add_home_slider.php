<?php

use App\Services\HomeContent;
use Database\Seeders\BanglaDemoContentSeeder;
use Illuminate\Database\Migrations\Migration;

/*
 * The home page slider: stored content gets hero_mode "banner" (the page looks as before), the default
 * slider settings, and three demo slides built from the demo store, so staff can switch to the slider
 * and see it at once. Slides that already exist are never replaced. The Bangla drafts come from
 * BanglaDemoContentSeeder (only empty fields whose English is still the demo text).
 */
return new class extends Migration
{
    public const DEMO_SLIDE_IDS = ['new-season', 'workday-laptops', 'signature-fragrances'];

    public function up(): void
    {
        $home = app(HomeContent::class);
        $content = $home->get(); // fills hero_mode "banner" and the slider defaults when they are missing

        // No home content at all (nothing to add slides to), or slides were made already: leave it.
        if (! is_array($content['hero']) || $content['slides'] !== []) {
            return;
        }

        $content['slides'] = $this->demoSlides();
        $home->save($content);

        (new BanglaDemoContentSeeder)->run();
    }

    public function down(): void
    {
        $home = app(HomeContent::class);
        $content = $home->get();
        $content['slides'] = array_values(array_filter($content['slides'], fn ($slide) => ! in_array($slide['id'] ?? null, self::DEMO_SLIDE_IDS, true)));
        if ($content['slides'] === []) {
            $content['hero_mode'] = 'banner';
        }
        $home->save($content);
    }

    private function demoSlides(): array
    {
        $slide = fn (array $fields) => [
            'eyebrow' => null, 'title' => '', 'description' => null, 'primary_cta' => null, 'secondary_cta' => null,
            'image_url' => null, 'image_alt' => null, 'tone' => 'navy', 'position' => 0, 'is_active' => true, 'bn' => null,
            ...$fields,
        ];

        return [
            $slide([
                'id' => 'new-season',
                'eyebrow' => 'New season essentials',
                'title' => 'Fresh picks for the new season',
                'description' => 'Headphones, gadgets, fashion, and home essentials — new arrivals every week at prices that make sense.',
                'primary_cta' => ['label' => 'Shop now', 'url' => '/products'],
                'secondary_cta' => ['label' => 'Explore deals', 'url' => '/deals'],
                'image_url' => 'https://cdn.dummyjson.com/product-images/mobile-accessories/apple-airpods-max-silver/1.webp',
                'image_alt' => 'Apple AirPods Max over-ear headphones in silver',
                'tone' => 'navy',
                'position' => 0,
            ]),
            $slide([
                'id' => 'workday-laptops',
                'eyebrow' => 'Laptops',
                'title' => 'Power for every workday',
                'description' => 'Lightweight laptops with all-day battery for work, study, and play.',
                'primary_cta' => ['label' => 'Shop laptops', 'url' => '/categories/laptops'],
                'image_url' => 'https://cdn.dummyjson.com/product-images/laptops/huawei-matebook-x-pro/1.webp',
                'image_alt' => 'Huawei MateBook X Pro laptop',
                'tone' => 'emerald',
                'position' => 1,
            ]),
            $slide([
                'id' => 'signature-fragrances',
                'eyebrow' => 'Fragrances',
                'title' => 'A scent for every moment',
                'description' => 'Gift-ready perfumes from Chanel, Dior, Gucci and more.',
                'primary_cta' => ['label' => 'Shop fragrances', 'url' => '/categories/fragrances'],
                'image_url' => 'https://cdn.dummyjson.com/product-images/fragrances/chanel-coco-noir-eau-de/1.webp',
                'image_alt' => 'Chanel Coco Noir eau de parfum bottle',
                'tone' => 'rose',
                'position' => 2,
            ]),
        ];
    }
};
