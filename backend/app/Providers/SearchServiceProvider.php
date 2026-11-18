<?php

namespace App\Providers;

use App\Models\Brand;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Services\SearchIndex;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\ServiceProvider;

/**
 * Phase 10 (part A): keeps the search index in step with the catalog.
 *
 * - products.search_text (brand, category, tags, SKUs) is set when a product
 *   is saved, and refreshed for the products concerned when a variant SKU,
 *   a brand name, or a category name changes.
 * - The vocabulary (typo corrections) is rebuilt once after any change that
 *   can change what shoppers find (SearchIndex::scheduleRebuild()).
 *
 * Changes made with plain queries (none in the app today) are caught by
 * `php artisan buynest:search:reindex` and its daily run.
 */
class SearchServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // One per request: it remembers whether a rebuild is already scheduled.
        $this->app->singleton(SearchIndex::class);
    }

    public function boot(): void
    {
        $index = fn (): SearchIndex => $this->app->make(SearchIndex::class);

        Product::saving(function (Product $product) {
            if (! $product->exists || $product->search_text === null || $product->isDirty(['sku', 'tags', 'brand_id', 'category_id'])) {
                $product->search_text = SearchIndex::textFor(
                    $product->brand_id ? DB::table('brands')->where('id', $product->brand_id)->value('name') : null,
                    $product->category_id ? DB::table('categories')->where('id', $product->category_id)->value('name') : null,
                    $product->tags,
                    $product->sku,
                    $product->exists ? DB::table('product_variants')->where('product_id', $product->id)->orderBy('id')->pluck('sku')->all() : [],
                );
            }
        });
        Product::saved(function (Product $product) use ($index) {
            if ($product->wasRecentlyCreated || $product->wasChanged(['name', 'status', 'category_id', 'brand_id', 'tags', 'deleted_at'])) {
                $index()->scheduleRebuild();
            }
        });
        Product::deleted(fn () => $index()->scheduleRebuild());
        Product::restored(fn () => $index()->scheduleRebuild());

        ProductVariant::saved(function (ProductVariant $variant) use ($index) {
            if ($variant->wasRecentlyCreated || $variant->wasChanged(['sku', 'product_id'])) {
                $index()->refreshProducts([$variant->product_id]);
            }
        });
        ProductVariant::deleted(fn (ProductVariant $variant) => $index()->refreshProducts([$variant->product_id]));

        Brand::saved(function (Brand $brand) use ($index) {
            if ($brand->wasChanged('name')) {
                $index()->refreshProducts(DB::table('products')->where('brand_id', $brand->id)->pluck('id')->all());
                $index()->scheduleRebuild();
            }
        });
        Brand::deleted(fn () => $index()->scheduleRebuild());

        Category::saved(function (Category $category) use ($index) {
            if ($category->wasChanged('name')) {
                $index()->refreshProducts(DB::table('products')->where('category_id', $category->id)->pluck('id')->all());
            }
            // A hidden or moved category changes which products are for sale.
            if ($category->wasChanged(['name', 'is_active', 'parent_id'])) {
                $index()->scheduleRebuild();
            }
        });
        Category::deleted(fn () => $index()->scheduleRebuild());
    }
}
