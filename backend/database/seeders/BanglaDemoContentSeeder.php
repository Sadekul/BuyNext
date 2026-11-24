<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\CategoryTranslation;
use App\Services\HomeContent;
use Illuminate\Database\Seeder;

/**
 * Bangla drafts for the demo store's own content: the home hero, the home
 * banners, the home slides, and the 24 demo category names (written by BuyNest; listed in
 * docs/I18N.md for review by a Bangla speaker).
 *
 * Idempotent and careful with staff edits: a Bangla field is filled only
 * when it is empty AND its English text is still the demo text, so content
 * staff wrote or translated themselves is never changed.
 */
class BanglaDemoContentSeeder extends Seeder
{
    /** Demo category slug => Bangla name. */
    public const CATEGORIES = [
        'beauty' => 'সৌন্দর্য',
        'fragrances' => 'সুগন্ধি',
        'furniture' => 'আসবাবপত্র',
        'groceries' => 'মুদি পণ্য',
        'home-decoration' => 'ঘর সাজানো',
        'kitchen-accessories' => 'রান্নাঘরের সামগ্রী',
        'laptops' => 'ল্যাপটপ',
        'mens-shirts' => 'ছেলেদের শার্ট',
        'mens-shoes' => 'ছেলেদের জুতা',
        'mens-watches' => 'ছেলেদের ঘড়ি',
        'mobile-accessories' => 'মোবাইল এক্সেসরিজ',
        'motorcycle' => 'মোটরসাইকেল',
        'skin-care' => 'ত্বকের যত্ন',
        'smartphones' => 'স্মার্টফোন',
        'sports-accessories' => 'খেলাধুলার সামগ্রী',
        'sunglasses' => 'সানগ্লাস',
        'tablets' => 'ট্যাবলেট',
        'tops' => 'টপস',
        'vehicle' => 'গাড়ি',
        'womens-bags' => 'মেয়েদের ব্যাগ',
        'womens-dresses' => 'মেয়েদের পোশাক',
        'womens-jewellery' => 'মেয়েদের গয়না',
        'womens-shoes' => 'মেয়েদের জুতা',
        'womens-watches' => 'মেয়েদের ঘড়ি',
    ];

    /** The demo home texts (English as seeded) => Bangla. */
    public const HOME_TEXTS = [
        // Hero
        'New season essentials' => 'নতুন মৌসুমের প্রয়োজনীয় পণ্য',
        'Everything you love, delivered to your nest.' => 'আপনার পছন্দের সবকিছু, পৌঁছে যাবে আপনার দোরগোড়ায়।',
        'Discover premium electronics, fashion, beauty, and home essentials — curated for quality and priced for everyday life.' => 'প্রিমিয়াম ইলেকট্রনিক্স, ফ্যাশন, সৌন্দর্য আর ঘরের প্রয়োজনীয় পণ্য — মানে সেরা, দামে সাধ্যের মধ্যে।',
        'Shop now' => 'এখনই কিনুন',
        'Explore deals' => 'অফারগুলো দেখুন',
        'Apple AirPods Max over-ear headphones in silver' => 'সিলভার রঙের অ্যাপল এয়ারপডস ম্যাক্স হেডফোন',
        'Free shipping over $50' => '$৫০-এর বেশি অর্ডারে ফ্রি শিপিং',
        '30-day returns' => '৩০ দিনের মধ্যে রিটার্ন',
        'Secure checkout' => 'নিরাপদ চেকআউট',
        // Banner: laptops
        'Laptops' => 'ল্যাপটপ',
        'Work from anywhere' => 'যেকোনো জায়গা থেকে কাজ করুন',
        'Thin, light, powerful laptops for work and play.' => 'কাজ আর বিনোদনের জন্য পাতলা, হালকা ও শক্তিশালী ল্যাপটপ।',
        'Shop laptops' => 'ল্যাপটপ দেখুন',
        'Huawei MateBook X Pro laptop' => 'হুয়াওয়ে মেটবুক এক্স প্রো ল্যাপটপ',
        // Banner: fragrances
        'Fragrances' => 'সুগন্ধি',
        'Find your signature scent' => 'খুঁজে নিন আপনার নিজস্ব সুবাস',
        'Iconic fragrances from Chanel, Dior, Gucci and more.' => 'শ্যানেল, ডিওর, গুচিসহ আরও অনেক ব্র্যান্ডের জনপ্রিয় সুগন্ধি।',
        'Shop fragrances' => 'সুগন্ধি দেখুন',
        'Chanel Coco Noir eau de parfum bottle' => 'শ্যানেল কোকো নোয়ার ও দো পারফাম বোতল',
        // Slides (the demo slider; also uses the hero and banner texts above)
        'Fresh picks for the new season' => 'নতুন মৌসুমের বাছাই করা পণ্য',
        'Headphones, gadgets, fashion, and home essentials — new arrivals every week at prices that make sense.' => 'হেডফোন, গ্যাজেট, ফ্যাশন আর ঘরের প্রয়োজনীয় পণ্য — প্রতি সপ্তাহে নতুন কালেকশন, সাধ্যের মধ্যে দামে।',
        'Power for every workday' => 'প্রতিটি কাজের দিনের শক্তিশালী সঙ্গী',
        'Lightweight laptops with all-day battery for work, study, and play.' => 'কাজ, পড়াশোনা আর বিনোদনের জন্য সারাদিন চার্জ থাকা হালকা ল্যাপটপ।',
        'A scent for every moment' => 'প্রতিটি মুহূর্তের জন্য একটি সুবাস',
        'Gift-ready perfumes from Chanel, Dior, Gucci and more.' => 'উপহার দেওয়ার মতো সুগন্ধি — শ্যানেল, ডিওর, গুচিসহ আরও অনেক ব্র্যান্ডের।',
    ];

    public function run(): void
    {
        $this->categories();
        $this->home();
    }

    private function categories(): void
    {
        foreach (Category::whereIn('slug', array_keys(self::CATEGORIES))->get() as $category) {
            $translation = CategoryTranslation::firstOrNew(['category_id' => $category->id, 'locale' => 'bn']);
            if (blank($translation->name)) {
                $translation->name = self::CATEGORIES[$category->slug];
                $translation->save();
            }
        }
    }

    private function home(): void
    {
        $home = app(HomeContent::class);
        $content = $home->get();
        $changed = false;

        if (is_array($content['hero'])) {
            $hero = $content['hero'];
            $bn = is_array($hero['bn'] ?? null) ? $hero['bn'] : [];
            foreach (['eyebrow', 'title', 'description', 'image_alt'] as $field) {
                $changed = $this->fill($bn, $field, $hero[$field] ?? null) || $changed;
            }
            foreach (['primary_cta', 'secondary_cta'] as $cta) {
                $changed = $this->fill($bn, "{$cta}_label", $hero[$cta]['label'] ?? null) || $changed;
            }
            // Highlights replace the English list as a whole: only when every one is a demo text.
            $highlights = array_values(array_filter($hero['highlights'] ?? [], 'filled'));
            if (empty($bn['highlights']) && $highlights && collect($highlights)->every(fn ($text) => isset(self::HOME_TEXTS[$text]))) {
                $bn['highlights'] = array_map(fn ($text) => self::HOME_TEXTS[$text], $highlights);
                $changed = true;
            }
            $hero['bn'] = $bn;
            $content['hero'] = $hero;
        }

        foreach ($content['banners'] as $index => $banner) {
            $bn = is_array($banner['bn'] ?? null) ? $banner['bn'] : [];
            foreach (['eyebrow', 'title', 'description', 'image_alt'] as $field) {
                $changed = $this->fill($bn, $field, $banner[$field] ?? null) || $changed;
            }
            $changed = $this->fill($bn, 'cta_label', $banner['cta']['label'] ?? null) || $changed;
            $content['banners'][$index]['bn'] = $bn;
        }

        foreach ($content['slides'] as $index => $slide) {
            $bn = is_array($slide['bn'] ?? null) ? $slide['bn'] : [];
            foreach (['eyebrow', 'title', 'description', 'image_alt'] as $field) {
                $changed = $this->fill($bn, $field, $slide[$field] ?? null) || $changed;
            }
            foreach (['primary_cta', 'secondary_cta'] as $cta) {
                $changed = $this->fill($bn, "{$cta}_label", $slide[$cta]['label'] ?? null) || $changed;
            }
            $content['slides'][$index]['bn'] = $bn;
        }

        if ($changed) {
            $home->save($content);
        }
    }

    /** Fill $bn[$field] from the English demo text when it is empty; true when something was filled. */
    private function fill(array &$bn, string $field, ?string $english): bool
    {
        if (filled($bn[$field] ?? null) || $english === null || ! isset(self::HOME_TEXTS[$english])) {
            return false;
        }
        $bn[$field] = self::HOME_TEXTS[$english];

        return true;
    }
}
