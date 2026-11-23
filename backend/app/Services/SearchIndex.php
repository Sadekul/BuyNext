<?php

namespace App\Services;

use App\Jobs\RebuildSearchVocabulary;
use App\Support\CategoryTree;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Phase 10 (part A): what the catalog search reads besides the products
 * table itself.
 *
 * - products.search_text: brand name, category name, tags, SKU and variant
 *   SKUs in one column, so the FULLTEXT index (name, description,
 *   search_text) covers them. Kept up to date on every save (see
 *   SearchServiceProvider) and refreshed for all products by rebuild().
 * - search_vocabulary: every word shoppers can find (names, brands,
 *   categories, tags of products for sale) with the number of products using
 *   it. SearchCorrector picks typo corrections from it.
 *
 * Everything here uses plain queries (no model events), so it can run from
 * a migration, a job, or a model event without triggering itself again.
 */
class SearchIndex
{
    /** Words longer than this aren't kept (nobody types them; the column is 64 characters). */
    public const MAX_WORD_LENGTH = 64;

    private const PENDING_KEY = 'search_index.rebuild_pending';

    /** A rebuild is already scheduled for the end of this request/command (sync queue). */
    private bool $scheduled = false;

    /**
     * Lower-case words (letters and digits, 1+ characters) of a text, in order,
     * duplicates kept. "iPhone 13-Pro" → ["iphone", "13", "pro"].
     *
     * @return list<string>
     */
    public static function words(?string $text): array
    {
        $parts = preg_split('/[^\p{L}\p{M}\p{N}]+/u', mb_strtolower((string) $text), -1, PREG_SPLIT_NO_EMPTY);

        return array_values(array_filter($parts ?: [], fn (string $word) => mb_strlen($word) <= self::MAX_WORD_LENGTH));
    }

    /** search_text for one product: brand, category, tags, SKU, variant SKUs (one line, space separated). */
    public static function textFor(?string $brand, ?string $category, mixed $tags, ?string $sku, array $variantSkus = []): string
    {
        if (is_string($tags)) {
            $tags = json_decode($tags, true);
        }
        $parts = [$brand, $category, ...(is_array($tags) ? array_filter($tags, 'is_string') : []), $sku, ...$variantSkus];

        return mb_substr(implode(' ', array_filter(array_map(fn ($part) => trim((string) $part), $parts), fn ($part) => $part !== '')), 0, 60000);
    }

    /** Recomputes search_text for these products (all of them when $ids is null). Returns how many were looked at. */
    public function refreshProducts(?array $ids = null): int
    {
        $count = 0;
        DB::table('products')
            ->leftJoin('brands', 'brands.id', '=', 'products.brand_id')
            ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
            ->when($ids !== null, fn ($query) => $query->whereIn('products.id', $ids ?: [0]))
            ->select(['products.id', 'products.sku', 'products.tags', 'products.search_text', 'brands.name as brand_name', 'categories.name as category_name'])
            ->orderBy('products.id')
            ->chunk(500, function ($products) use (&$count) {
                $variantSkus = DB::table('product_variants')->whereIn('product_id', $products->pluck('id'))
                    ->orderBy('id')->get(['product_id', 'sku'])->groupBy('product_id');
                foreach ($products as $product) {
                    $text = self::textFor($product->brand_name, $product->category_name, $product->tags, $product->sku,
                        ($variantSkus[$product->id] ?? collect())->pluck('sku')->all());
                    if ($text !== $product->search_text) {
                        DB::table('products')->where('id', $product->id)->update(['search_text' => $text]);
                    }
                    $count++;
                }
            });

        return $count;
    }

    /** Rebuilds the vocabulary from the products for sale. Returns the number of words. */
    public function rebuildVocabulary(): int
    {
        $counts = [];
        $visible = CategoryTree::load()->visibleIds();
        DB::table('products')
            ->leftJoin('brands', 'brands.id', '=', 'products.brand_id')
            ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
            ->whereNull('products.deleted_at')
            ->where('products.status', 'active')
            ->whereIn('products.category_id', $visible ?: [0])
            ->select(['products.id', 'products.name', 'products.tags', 'brands.name as brand_name', 'categories.name as category_name'])
            ->orderBy('products.id')
            ->chunk(1000, function ($products) use (&$counts) {
                foreach ($products as $product) {
                    $tags = is_string($product->tags) ? json_decode($product->tags, true) : null;
                    $text = implode(' ', [$product->name, $product->brand_name, $product->category_name,
                        ...(is_array($tags) ? array_filter($tags, 'is_string') : [])]);
                    // Counted once per product: "how many products use this word".
                    foreach (array_unique(self::words($text)) as $word) {
                        if (mb_strlen($word) >= 2) {
                            $counts[$word] = ($counts[$word] ?? 0) + 1;
                        }
                    }
                }
            });

        $now = now();
        $rows = [];
        foreach ($counts as $word => $count) {
            $rows[] = ['word' => (string) $word, 'count' => $count, 'length' => min(255, mb_strlen((string) $word)), 'updated_at' => $now];
        }
        // One transaction: searches keep seeing the old list until the new one is complete.
        DB::transaction(function () use ($rows) {
            DB::table('search_vocabulary')->delete();
            foreach (array_chunk($rows, 1000) as $chunk) {
                DB::table('search_vocabulary')->insert($chunk);
            }
        });

        return count($rows);
    }

    /** Everything: search_text for every product, then the vocabulary. [products, words]. */
    public function rebuild(): array
    {
        Cache::forget(self::PENDING_KEY);
        $this->scheduled = false;

        return [$this->refreshProducts(), $this->rebuildVocabulary()];
    }

    /**
     * Something in the catalog changed: rebuild once, a little later, however
     * many changes come. With the sync queue (development, tests) that is once
     * at the end of this request or command; with a real queue it is one job
     * 60 seconds later (the cache key keeps others from being queued meanwhile).
     */
    public function scheduleRebuild(): void
    {
        if (config('queue.default') === 'sync') {
            if (! $this->scheduled) {
                $this->scheduled = true;
                app()->terminating(function () {
                    if ($this->scheduled) {
                        $this->scheduled = false;
                        $this->rebuildVocabularySafely();
                    }
                });
            }

            return;
        }
        if (Cache::add(self::PENDING_KEY, true, now()->addSeconds(90))) {
            RebuildSearchVocabulary::dispatch()->delay(now()->addSeconds(60))->afterCommit();
        }
    }

    /** The job: the vocabulary only (search_text is kept on save). Changes from now on schedule another run. */
    public function runScheduledRebuild(): int
    {
        Cache::forget(self::PENDING_KEY);

        return $this->rebuildVocabulary();
    }

    private function rebuildVocabularySafely(): void
    {
        try {
            $this->rebuildVocabulary();
        } catch (\Throwable $e) {
            report($e); // search still works; only corrections use the vocabulary
        }
    }
}
