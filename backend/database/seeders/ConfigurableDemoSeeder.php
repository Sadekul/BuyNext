<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\Product;
use App\Models\ProductVariant;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Phase 16: turns six demo (DummyJSON) products into configurable products
 * (Magento's product page): colour swatches with sizes, phones with storage
 * and colour, a laptop with RAM and storage. Bangla option/value names go in
 * the phase 13 `translations`.
 *
 * Idempotent and careful with staff work: a product is changed only when it
 * still has its demo SKU and demo name, is not deleted, and has no options
 * and no variants yet. Nothing is downloaded: per-colour photos reuse the
 * product's own imported images (image 1, 2, 3... go to colour 1, 2, 3...;
 * image 0 stays shared), and only when it has more images than colours.
 *
 * Stock: the product's current stock is split over the stocked combinations
 * (at least 1 each); the combinations in `sold_out` get 0 so the store can
 * show crossed-out choices. Prices: `add` is a fraction of the product's price
 * per value (summed per combination, rounded to .99); combinations with no
 * add use the product's price (variant price null).
 *
 * Run by the migration 2026_11_24_000500 (existing installs) and by
 * buynest:import-catalog after importing (fresh installs).
 */
class ConfigurableDemoSeeder extends Seeder
{
    /** Demo SKU => definition. Option values: [value, Bangla value|null, swatch|null, add]. */
    public const PRODUCTS = [
        'MEN-FAS-BLU-083' => [
            'name' => 'Blue & Black Check Shirt',
            'options' => [
                ['name' => 'Color', 'bn' => 'রং', 'type' => 'color', 'values' => [
                    ['Blue', 'নীল', '#1E3A8A', 0], ['Black', 'কালো', '#111827', 0], ['Grey', 'ধূসর', '#6B7280', 0]]],
                ['name' => 'Size', 'bn' => 'সাইজ', 'type' => 'text', 'values' => [
                    ['S', null, null, 0], ['M', null, null, 0], ['L', null, null, 0], ['XL', null, null, 0]]],
            ],
            'sold_out' => [['Black', 'S'], ['Grey', 'XL']],
        ],
        'MEN-CLA-PLA-085' => [
            'name' => 'Man Plaid Shirt',
            'options' => [
                ['name' => 'Color', 'bn' => 'রং', 'type' => 'color', 'values' => [
                    ['Red', 'লাল', '#B91C1C', 0], ['Blue', 'নীল', '#1D4ED8', 0], ['Green', 'সবুজ', '#15803D', 0]]],
                ['name' => 'Size', 'bn' => 'সাইজ', 'type' => 'text', 'values' => [
                    ['S', null, null, 0], ['M', null, null, 0], ['L', null, null, 0], ['XL', null, null, 0]]],
            ],
            // Green is sold out in every size: its swatch is crossed out before anything is chosen.
            'sold_out' => [['Green', 'S'], ['Green', 'M'], ['Green', 'L'], ['Green', 'XL'], ['Red', 'XL']],
        ],
        'MEN-PUM-PUM-090' => [
            'name' => 'Puma Future Rider Trainers',
            'options' => [
                ['name' => 'Color', 'bn' => 'রং', 'type' => 'color', 'values' => [
                    ['White', 'সাদা', '#F9FAFB', 0], ['Black', 'কালো', '#111827', 0], ['Blue', 'নীল', '#2563EB', 0]]],
                ['name' => 'Size', 'bn' => 'সাইজ', 'type' => 'text', 'values' => [
                    ['40', '৪০', null, 0], ['41', '৪১', null, 0], ['42', '৪২', null, 0], ['43', '৪৩', null, 0], ['44', '৪৪', null, 0]]],
            ],
            'sold_out' => [['Blue', '40'], ['Blue', '41'], ['Black', '44']],
        ],
        'SMA-APP-IPH-123' => [
            'name' => 'iPhone 13 Pro',
            'options' => [
                ['name' => 'Storage', 'bn' => 'স্টোরেজ', 'type' => 'text', 'values' => [
                    ['128 GB', '১২৮ জিবি', null, 0], ['256 GB', '২৫৬ জিবি', null, 0.15], ['512 GB', '৫১২ জিবি', null, 0.35]]],
                ['name' => 'Color', 'bn' => 'রং', 'type' => 'color', 'values' => [
                    ['Graphite', 'গ্রাফাইট', '#41424C', 0], ['Sierra Blue', 'সিয়েরা ব্লু', '#9BB5CE', 0]]],
            ],
            'sold_out' => [['512 GB', 'Sierra Blue']],
        ],
        'SMA-SAM-SAM-133' => [
            'name' => 'Samsung Galaxy S10',
            'options' => [
                ['name' => 'Storage', 'bn' => 'স্টোরেজ', 'type' => 'text', 'values' => [
                    ['128 GB', '১২৮ জিবি', null, 0], ['256 GB', '২৫৬ জিবি', null, 0.15], ['512 GB', '৫১২ জিবি', null, 0.35]]],
                ['name' => 'Color', 'bn' => 'রং', 'type' => 'color', 'values' => [
                    ['Prism Black', 'প্রিজম কালো', '#1F2937', 0], ['Prism White', 'প্রিজম সাদা', '#F3F4F6', 0], ['Prism Blue', 'প্রিজম নীল', '#3B82F6', 0]]],
            ],
            'sold_out' => [['512 GB', 'Prism White'], ['128 GB', 'Prism Blue']],
        ],
        'LAP-DEL-DEL-082' => [
            'name' => 'New DELL XPS 13 9300 Laptop',
            'options' => [
                ['name' => 'RAM', 'bn' => 'র‍্যাম', 'type' => 'text', 'values' => [
                    ['8 GB', '৮ জিবি', null, 0], ['16 GB', '১৬ জিবি', null, 0.20]]],
                ['name' => 'Storage', 'bn' => 'স্টোরেজ', 'type' => 'text', 'values' => [
                    ['256 GB', '২৫৬ জিবি', null, 0], ['512 GB', '৫১২ জিবি', null, 0.12]]],
            ],
            'sold_out' => [['8 GB', '512 GB']],
        ],
    ];

    /**
     * Demo products the browser suites buy as simple products (iPhone 5s, iPhone X, American Football, Tartan Dress):
     * real stores sell simple products too, so these stay without options.
     */
    public const KEEP_SIMPLE = [121, 124, 137, 166];

    /** Colour words => [Bangla, swatch]: the palette of the category rules (a colour named in the product's name comes first). */
    public const COLOURS = [
        'Black' => ['কালো', '#111827'], 'White' => ['সাদা', '#F9FAFB'], 'Grey' => ['ধূসর', '#6B7280'], 'Navy' => ['নেভি', '#1E3A5F'],
        'Blue' => ['নীল', '#1D4ED8'], 'Red' => ['লাল', '#B91C1C'], 'Green' => ['সবুজ', '#15803D'], 'Brown' => ['বাদামি', '#7C4A21'],
        'Beige' => ['বেইজ', '#D6C3A5'], 'Pink' => ['গোলাপি', '#DB2777'], 'Gold' => ['সোনালি', '#C9A227'], 'Silver' => ['রুপালি', '#C0C4CC'],
        'Rose Gold' => ['রোজ গোল্ড', '#D4A59A'], 'Space Grey' => ['স্পেস গ্রে', '#4B4F58'], 'Starlight' => ['স্টারলাইট', '#E8E1D5'],
        'Tortoise' => ['টরটয়েজ', '#6B3E26'], 'Purple' => ['বেগুনি', '#7E22CE'],
    ];

    /**
     * Category slug => rule for every other demo product in it: `colours` (the palette), `second` (a text option:
     * [name, Bangla name, [[value, Bangla|null, add], ...]]) or null, and `first` ('color' or 'text': which option
     * comes first). Phones and tablets: Storage × Color; laptops: RAM × Storage (no colour); fashion: Color × Size.
     */
    public const CATEGORY_RULES = [
        'mens-shirts' => ['colours' => ['White', 'Black', 'Navy', 'Grey'], 'second' => self::SIZES_MEN],
        'tops' => ['colours' => ['Pink', 'Blue', 'White', 'Black'], 'second' => self::SIZES_WOMEN],
        'womens-dresses' => ['colours' => ['Black', 'Red', 'Navy', 'Beige'], 'second' => self::SIZES_WOMEN],
        'mens-shoes' => ['colours' => ['Black', 'White', 'Red', 'Blue'], 'second' => ['Size', 'সাইজ', [['40', '৪০', 0], ['41', '৪১', 0], ['42', '৪২', 0], ['43', '৪৩', 0], ['44', '৪৪', 0]]]],
        'womens-shoes' => ['colours' => ['Black', 'Red', 'Gold', 'Beige'], 'second' => ['Size', 'সাইজ', [['36', '৩৬', 0], ['37', '৩৭', 0], ['38', '৩৮', 0], ['39', '৩৯', 0], ['40', '৪০', 0]]]],
        'smartphones' => ['colours' => ['Black', 'Silver', 'Blue', 'Green'], 'first' => 'text', 'second' => self::STORAGE_PHONE],
        'tablets' => ['colours' => ['Space Grey', 'Silver', 'Starlight'], 'first' => 'text', 'second' => self::STORAGE_TABLET],
        'laptops' => ['colours' => [], 'first' => 'text', 'second' => ['RAM', 'র‍্যাম', [['8 GB', '৮ জিবি', 0], ['16 GB', '১৬ জিবি', 0.12], ['32 GB', '৩২ জিবি', 0.3]]],
            'third' => ['Storage', 'স্টোরেজ', [['512 GB', '৫১২ জিবি', 0], ['1 TB', '১ টিবি', 0.15]]]],
        'mens-watches' => ['colours' => ['Silver', 'Gold', 'Black'], 'second' => null],
        'womens-watches' => ['colours' => ['Silver', 'Gold', 'Rose Gold'], 'second' => null],
        'sunglasses' => ['colours' => ['Black', 'Tortoise', 'Gold', 'Green'], 'second' => null],
        'womens-bags' => ['colours' => ['Black', 'Brown', 'Beige', 'White'], 'second' => null],
    ];

    private const SIZES_MEN = ['Size', 'সাইজ', [['S', null, 0], ['M', null, 0], ['L', null, 0], ['XL', null, 0], ['XXL', null, 0.05]]];

    private const SIZES_WOMEN = ['Size', 'সাইজ', [['XS', null, 0], ['S', null, 0], ['M', null, 0], ['L', null, 0], ['XL', null, 0]]];

    private const STORAGE_PHONE = ['Storage', 'স্টোরেজ', [['64 GB', '৬৪ জিবি', 0], ['128 GB', '১২৮ জিবি', 0.1], ['256 GB', '২৫৬ জিবি', 0.25]]];

    private const STORAGE_TABLET = ['Storage', 'স্টোরেজ', [['64 GB', '৬৪ জিবি', 0], ['256 GB', '২৫৬ জিবি', 0.2]]];

    public function run(): void
    {
        foreach (self::PRODUCTS as $sku => $definition) {
            DB::transaction(function () use ($sku, $definition) {
                $product = Product::where('sku', $sku)->where('name', $definition['name'])->lockForUpdate()->first();
                if (! $product || $product->options()->exists() || $product->variants()->exists()) {
                    return; // not a demo product any more, or staff already set it up
                }
                $this->configure($product, $definition);
            });
        }

        // Every other demo product of the categories above (never staff products: see isDemo()).
        $categories = Category::whereIn('slug', array_keys(self::CATEGORY_RULES))->pluck('slug', 'id');
        $candidates = Product::whereIn('category_id', $categories->keys())->whereNotIn('id', self::KEEP_SIMPLE)
            ->where('has_variants', false)->orderBy('id')->pluck('id');
        foreach ($candidates as $id) {
            DB::transaction(function () use ($id, $categories) {
                $product = Product::lockForUpdate()->find($id);
                if (! $product || ! self::isDemo($product) || $product->options()->exists() || $product->variants()->exists()) {
                    return;
                }
                $this->configure($product, self::definitionFor($product, self::CATEGORY_RULES[$categories[$product->category_id]]), assignImages: false);
            });
        }
    }

    /** An imported demo product: its DummyJSON SKU ("MEN-FAS-BLU-083") ends with its own id. Staff products never match. */
    public static function isDemo(Product $product): bool
    {
        return (bool) preg_match('/^[A-Z]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}-(\d{3})$/', (string) $product->sku, $match) && (int) $match[1] === $product->id;
    }

    /** The definition for a demo product from its category rule (the same shape as PRODUCTS). */
    public static function definitionFor(Product $product, array $rule): array
    {
        // A colour named in the product's name ("Red Shoes", "Gray Dress") comes first.
        $palette = $rule['colours'];
        foreach (array_keys(self::COLOURS) as $colour) {
            $word = $colour === 'Grey' ? '(Grey|Gray)' : preg_quote($colour, '/');
            if ($palette && preg_match("/\b{$word}\b/i", $product->name)) {
                $palette = array_values(array_unique([$colour, ...$palette]));
                break;
            }
        }
        $palette = array_slice($palette, 0, 4);

        $options = [];
        if ($palette) {
            $options[] = ['name' => 'Color', 'bn' => 'রং', 'type' => 'color',
                'values' => array_map(fn ($colour) => [$colour, self::COLOURS[$colour][0], self::COLOURS[$colour][1], 0], $palette)];
        }
        foreach (['second', 'third'] as $key) {
            if (! empty($rule[$key])) {
                [$name, $bn, $values] = $rule[$key];
                $text = ['name' => $name, 'bn' => $bn, 'type' => 'text', 'values' => array_map(fn ($value) => [$value[0], $value[1], null, $value[2]], $values)];
                ($rule['first'] ?? 'color') === 'text' && $key === 'second' ? array_unshift($options, $text) : $options[] = $text;
            }
        }

        // One sold-out combination (the last value of each option) so the store shows a crossed-out choice.
        $soldOut = [array_map(fn ($option) => end($option['values'])[0], $options)];

        return ['name' => $product->name, 'options' => $options, 'sold_out' => $soldOut];
    }

    private function configure(Product $product, array $definition, bool $assignImages = true): void
    {
        // Options and values (Bangla in the phase 13 translations).
        $valueIds = []; // option position => [[id, value, add], ...]
        foreach ($definition['options'] as $position => $input) {
            $option = $product->options()->create([
                'name' => $input['name'],
                'type' => $input['type'],
                'position' => $position,
                'translations' => ['bn' => ['name' => $input['bn']]],
            ]);
            foreach ($input['values'] as $valuePosition => [$value, $bn, $swatch, $add]) {
                $row = $option->values()->create([
                    'value' => $value,
                    'swatch' => $input['type'] === 'color' ? $swatch : null,
                    'position' => $valuePosition,
                    'translations' => $bn !== null ? ['bn' => ['value' => $bn]] : null,
                ]);
                $valueIds[$position][] = [$row->id, $value, $add];
            }
        }

        // Every combination, in option order.
        $combinations = [[]];
        foreach ($valueIds as $values) {
            $next = [];
            foreach ($combinations as $combination) {
                foreach ($values as $value) {
                    $next[] = [...$combination, $value];
                }
            }
            $combinations = $next;
        }

        $soldOut = array_map(fn ($names) => implode('|', $names), $definition['sold_out']);
        $isSoldOut = fn (array $combination) => in_array(implode('|', array_column($combination, 1)), $soldOut, true);
        $stocked = count(array_filter($combinations, fn ($combination) => ! $isSoldOut($combination)));
        $total = max(0, (int) $product->stock_quantity);
        $index = 0;
        $skus = [];
        foreach ($combinations as $combination) {
            $ids = array_column($combination, 0);
            $add = array_sum(array_column($combination, 2));
            $stock = 0;
            if (! $isSoldOut($combination)) {
                $stock = max(1, intdiv($total, $stocked) + ($index < $total % $stocked ? 1 : 0));
                $index++;
            }
            $sku = $this->uniqueSku(strtoupper(Str::slug(implode('-', [$product->sku, ...array_column($combination, 1)]))), $skus);
            $skus[] = $sku;
            $product->variants()->create([
                'sku' => $sku,
                'option_value_ids' => self::sorted($ids),
                'option_key' => ProductVariant::keyFor($ids),
                'price' => $add > 0 ? number_format(floor((float) $product->price * (1 + $add)) + 0.99, 2, '.', '') : null,
                'stock_quantity' => $stock,
                'is_active' => true,
            ]);
        }

        $product->forceFill(['has_variants' => true])->save();
        $product->syncVariantStock();
        // The category rules don't link photos to colours: a demo product's extra photos are other angles, not colours.
        if ($assignImages) {
            $this->assignColourImages($product);
        }
    }

    /** Image 1, 2, 3... of the imported images belong to colour 1, 2, 3... when there are more images than colours. */
    private function assignColourImages(Product $product): void
    {
        $color = $product->options()->where('type', 'color')->first();
        if (! $color) {
            return;
        }
        $values = $color->values()->get();
        $images = $product->images()->get();
        if ($images->count() <= $values->count()) {
            return;
        }
        foreach ($values as $i => $value) {
            $images[$i + 1]->update(['option_value_id' => $value->id]);
        }
    }

    private static function sorted(array $ids): array
    {
        $ids = array_map('intval', $ids);
        sort($ids);

        return $ids;
    }

    private function uniqueSku(string $base, array $taken): string
    {
        $base = substr($base, 0, 60);
        $sku = $base;
        for ($n = 2; in_array($sku, $taken, true) || Product::skuTaken($sku); $n++) {
            $sku = "{$base}-{$n}";
        }

        return $sku;
    }
}
