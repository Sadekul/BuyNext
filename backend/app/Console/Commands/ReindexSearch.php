<?php

namespace App\Console\Commands;

use App\Services\SearchIndex;
use Illuminate\Console\Command;

/**
 * Phase 10 (part A): refreshes every product's search_text and rebuilds the
 * search vocabulary (typo corrections). Run after importing products with
 * plain SQL; also scheduled daily as a safety net.
 */
class ReindexSearch extends Command
{
    protected $signature = 'buynest:search:reindex';

    protected $description = 'Rebuild the product search index and the typo-correction vocabulary';

    public function handle(SearchIndex $index): int
    {
        [$products, $words] = $index->rebuild();
        $this->info("Search index rebuilt: {$products} products, {$words} words.");

        return self::SUCCESS;
    }
}
