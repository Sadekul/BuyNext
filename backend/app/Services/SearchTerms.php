<?php

namespace App\Services;

use App\Models\SearchTerm;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Search terms (phase 7, Magento's Marketing → Search terms): what shoppers
 * type in the catalog search, how often, how many products it found, and an
 * optional redirect for an exact term.
 *
 * A visitor counts once per term per hour. The visitor is a hash of their IP
 * kept only as a cache key (it expires after the hour and is never stored
 * in the database).
 */
class SearchTerms
{
    public const MAX_LENGTH = 100;

    private const REDIRECTS_KEY = 'search_terms.redirects';

    /** Lower case, trimmed, inner spaces collapsed, at most 100 characters ("" = nothing to record). */
    public static function normalize(?string $term): string
    {
        $term = mb_strtolower(trim(preg_replace('/\s+/u', ' ', (string) $term)));

        return rtrim(mb_substr($term, 0, self::MAX_LENGTH));
    }

    /** Counts a search (once per term per visitor per hour) and saves how many products it found. */
    public function record(string $term, int $resultsCount, ?string $ip): void
    {
        if ($term === '') {
            return;
        }
        $visitor = hash_hmac('sha256', (string) $ip, (string) config('app.key'));
        if (! Cache::add('search_term:'.hash('sha256', $visitor.'|'.$term), true, now()->addHour())) {
            return; // this visitor already counted this term in the last hour
        }
        $now = now();
        DB::table('search_terms')->upsert(
            [['term' => $term, 'hits' => 1, 'last_results_count' => $resultsCount, 'created_at' => $now, 'updated_at' => $now]],
            ['term'],
            ['hits' => DB::raw('hits + 1'), 'last_results_count' => $resultsCount, 'updated_at' => $now],
        );
    }

    /** The redirect for this exact (normalized) term, or null. All redirects are cached together (a short list). */
    public function redirectFor(string $term): ?string
    {
        if ($term === '') {
            return null;
        }
        $redirects = Cache::rememberForever(self::REDIRECTS_KEY,
            fn () => SearchTerm::whereNotNull('redirect_url')->pluck('redirect_url', 'term')->all());

        return $redirects[$term] ?? null;
    }

    public static function flushRedirects(): void
    {
        Cache::forget(self::REDIRECTS_KEY);
    }

    /** The most searched terms (for the dashboard): [{ term, hits, last_results_count }]. */
    public function top(int $limit = 5): array
    {
        return SearchTerm::orderByDesc('hits')->orderBy('term')->limit($limit)->get()
            ->map(fn (SearchTerm $term) => ['term' => $term->term, 'hits' => $term->hits, 'last_results_count' => $term->last_results_count])
            ->all();
    }
}
