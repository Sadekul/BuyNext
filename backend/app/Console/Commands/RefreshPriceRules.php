<?php

namespace App\Console\Commands;

use App\Services\CatalogRules;
use Illuminate\Console\Command;

/**
 * Rebuilds the cached catalog price rules when a rule's start or end time
 * has passed (scheduled every minute). Reads check the time too, so this
 * only makes sure the first shopper after the change doesn't pay for it.
 */
class RefreshPriceRules extends Command
{
    protected $signature = 'buynest:refresh-price-rules';

    protected $description = 'Refresh the cached catalog price rules when a rule starts or ends';

    public function handle(CatalogRules $rules): int
    {
        $this->info($rules->refreshIfStale() ? 'Catalog price rules refreshed.' : 'Catalog price rules are up to date.');

        return self::SUCCESS;
    }
}
