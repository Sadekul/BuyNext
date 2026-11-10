<?php

namespace App\Console\Commands;

use App\Models\Brand;
use App\Models\Category;
use App\Models\Product;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * php artisan buynest:import-catalog
 *
 * Copies the DummyJSON demo catalog into our database. Product ids stay equal
 * to DummyJSON's, so carts, wishlists, and links saved by the old demo still
 * work. Safe to run again: products are matched by SKU and updated.
 *
 * On a re-run, the fields the shop now owns (price, discount, stock, status)
 * are kept, so staff edits and stock taken by orders survive. --overwrite
 * resets those too.
 */
#[Signature('buynest:import-catalog {--overwrite : Also reset price, discount, stock, and status to DummyJSON\'s values}')]
#[Description('Import (or refresh) the demo catalog from dummyjson.com')]
class ImportCatalog extends Command
{
    private const SOURCE = 'https://dummyjson.com';

    /** @var array<string, int> brand name → id */
    private array $brandIds = [];

    public function handle(): int
    {
        $this->info('Downloading the catalog from '.self::SOURCE.' ...');
        $categories = Http::acceptJson()->timeout(30)->retry(2, 1000)->get(self::SOURCE.'/products/categories')->throw()->json();
        $products = Http::acceptJson()->timeout(60)->retry(2, 1000)->get(self::SOURCE.'/products', ['limit' => 0])->throw()->json('products');

        $counts = DB::transaction(fn () => $this->import($categories, $products));

        $this->info(sprintf(
            'Imported %d products (%d new, %d updated, %d skipped), %d categories, %d brands.',
            $counts['created'] + $counts['updated'], $counts['created'], $counts['updated'], $counts['skipped'],
            Category::count(), Brand::count(),
        ));

        return self::SUCCESS;
    }

    private function import(array $categories, array $products): array
    {
        $categoryIds = [];
        foreach (array_values($categories) as $position => $category) {
            $categoryIds[$category['slug']] = Category::updateOrCreate(
                ['slug' => $category['slug']],
                ['name' => $category['name'], 'position' => $position],
            )->id;
        }

        // DummyJSON has two products with the same title: the second one gets "-<id>" on its slug.
        $slugUses = [];
        $counts = ['created' => 0, 'updated' => 0, 'skipped' => 0];

        foreach (collect($products)->sortBy('id') as $item) {
            $categoryIds[$item['category']] ??= Category::firstOrCreate(
                ['slug' => $item['category']],
                ['name' => Str::title(str_replace('-', ' ', $item['category'])), 'position' => count($categoryIds)],
            )->id;

            $product = Product::withTrashed()->where('sku', $item['sku'])->first();
            if (! $product && Product::withTrashed()->whereKey($item['id'])->exists()) {
                // A product made in the admin already took this id: never overwrite it.
                $this->warn("Skipped {$item['sku']}: id {$item['id']} is used by another product.");
                $counts['skipped']++;

                continue;
            }

            $slug = Str::slug($item['title']);
            if (isset($slugUses[$slug]) || Product::withTrashed()->where('slug', $slug)->where('sku', '!=', $item['sku'])->exists()) {
                $slug .= '-'.$item['id'];
            }
            $slugUses[$slug] = true;

            $content = [
                'name' => $item['title'],
                'slug' => $slug,
                'description' => $item['description'] ?? null,
                'category_id' => $categoryIds[$item['category']],
                'brand_id' => $this->brandId($item['brand'] ?? null),
                'min_order_quantity' => max(1, (int) ($item['minimumOrderQuantity'] ?? 1)),
                'rating_average' => round((float) ($item['rating'] ?? 0), 2),
                'thumbnail_url' => $item['thumbnail'] ?? null,
                'warranty' => $item['warrantyInformation'] ?? null,
                'shipping_info' => $item['shippingInformation'] ?? null,
                'return_policy' => $item['returnPolicy'] ?? null,
                'weight' => isset($item['weight']) ? (int) $item['weight'] : null,
                'tags' => $item['tags'] ?? [],
            ];
            $shopOwned = [
                'price' => number_format((float) $item['price'], 2, '.', ''),
                'discount_percent' => number_format((float) ($item['discountPercentage'] ?? 0), 2, '.', ''),
                'stock_quantity' => max(0, (int) ($item['stock'] ?? 0)),
                'status' => 'active',
            ];

            if ($product) {
                $product->fill($this->option('overwrite') ? [...$content, ...$shopOwned] : $content)->save();
                $counts['updated']++;
            } else {
                $product = new Product(['sku' => $item['sku'], ...$content, ...$shopOwned]);
                $product->id = $item['id']; // keep DummyJSON's id (not mass assignable on purpose)
                $product->created_at = isset($item['meta']['createdAt']) ? Carbon::parse($item['meta']['createdAt']) : now();
                $product->save();
                $counts['created']++;
            }

            // Images and imported reviews are replaced as a whole (reviews by real customers are kept).
            $product->images()->delete();
            foreach (array_values($item['images'] ?? []) as $position => $url) {
                $product->images()->create(['url' => $url, 'alt' => $item['title'], 'position' => $position]);
            }
            $product->reviews()->whereNull('customer_id')->delete();
            foreach ($item['reviews'] ?? [] as $review) {
                $product->reviews()->create([
                    'author_name' => $review['reviewerName'],
                    'rating' => max(1, min(5, (int) $review['rating'])),
                    'comment' => $review['comment'],
                    'created_at' => Carbon::parse($review['date']),
                ]);
            }
        }

        // A category picture: the first product's thumbnail (until staff choose one).
        foreach (Category::whereNull('image_url')->get() as $category) {
            $category->update(['image_url' => $category->products()->orderBy('id')->value('thumbnail_url')]);
        }

        return $counts;
    }

    private function brandId(?string $name): ?int
    {
        $name = trim((string) $name);
        if ($name === '') {
            return null;
        }

        return $this->brandIds[$name] ??= Brand::firstOrCreate(['name' => $name])->id;
    }
}
