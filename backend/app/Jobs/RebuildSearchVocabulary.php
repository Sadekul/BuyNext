<?php

namespace App\Jobs;

use App\Services\SearchIndex;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Phase 10 (part A): rebuilds the search vocabulary (typo corrections) after
 * catalog changes. Queued 60 seconds after the first change by
 * SearchIndex::scheduleRebuild(), so a bulk edit or an import rebuilds once.
 */
class RebuildSearchVocabulary implements ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    public function handle(SearchIndex $index): void
    {
        $index->runScheduledRebuild();
    }
}
