<?php

use App\Services\Settings;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Store settings (one row per key, the value as JSON) and the home page
 * content (key "home_content"). Seeded with the values the shop had until
 * now (config/buynest.php and the storefront's frontend/src/data/homeContent.js),
 * so nothing changes for shoppers when this runs.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('settings', function (Blueprint $table) {
            $table->id();
            $table->string('key', 80)->unique();
            $table->json('value');
            $table->timestamps();
        });

        $now = now();
        $rows = [...Settings::DEFAULTS, 'home_content' => $this->homeContent()];
        foreach ($rows as $key => $value) {
            DB::table('settings')->insertOrIgnore(['key' => $key, 'value' => json_encode($value), 'created_at' => $now, 'updated_at' => $now]);
        }
        Cache::forget('buynest.settings');
    }

    public function down(): void
    {
        Schema::dropIfExists('settings');
        Cache::forget('buynest.settings');
    }

    /** The storefront's home page as it was (frontend/src/data/homeContent.js), with its routes as addresses. */
    private function homeContent(): array
    {
        return [
            'hero' => [
                'eyebrow' => 'New season essentials',
                'title' => 'Everything you love, delivered to your nest.',
                'description' => 'Discover premium electronics, fashion, beauty, and home essentials — curated for quality and priced for everyday life.',
                'primary_cta' => ['label' => 'Shop now', 'url' => '/products'],
                'secondary_cta' => ['label' => 'Explore deals', 'url' => '/deals'],
                'image_url' => 'https://cdn.dummyjson.com/product-images/mobile-accessories/apple-airpods-max-silver/1.webp',
                'image_alt' => 'Apple AirPods Max over-ear headphones in silver',
                'highlights' => ['Free shipping over $50', '30-day returns', 'Secure checkout'],
            ],
            'banners' => [
                [
                    'id' => 'work-anywhere',
                    'eyebrow' => 'Laptops',
                    'title' => 'Work from anywhere',
                    'description' => 'Thin, light, powerful laptops for work and play.',
                    'cta' => ['label' => 'Shop laptops', 'url' => '/categories/laptops'],
                    'image_url' => 'https://cdn.dummyjson.com/product-images/laptops/huawei-matebook-x-pro/1.webp',
                    'image_alt' => 'Huawei MateBook X Pro laptop',
                    'tone' => 'navy',
                    'position' => 0,
                    'is_active' => true,
                ],
                [
                    'id' => 'signature-scents',
                    'eyebrow' => 'Fragrances',
                    'title' => 'Find your signature scent',
                    'description' => 'Iconic fragrances from Chanel, Dior, Gucci and more.',
                    'cta' => ['label' => 'Shop fragrances', 'url' => '/categories/fragrances'],
                    'image_url' => 'https://cdn.dummyjson.com/product-images/fragrances/chanel-coco-noir-eau-de/1.webp',
                    'image_alt' => 'Chanel Coco Noir eau de parfum bottle',
                    'tone' => 'emerald',
                    'position' => 1,
                    'is_active' => true,
                ],
            ],
            // homeCollectionIds.featured in the storefront.
            'featured_product_ids' => [123, 78, 100, 173, 90, 7, 160, 14],
        ];
    }
};
