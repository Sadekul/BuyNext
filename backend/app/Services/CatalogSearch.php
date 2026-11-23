<?php

namespace App\Services;

use App\Models\Product;
use App\Support\CategoryTree;
use App\Support\Locale;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Phase 10 (part A): the storefront's product search (GET /api/v1/products?search=).
 *
 * Matching: the whole phrase anywhere (as in phase 2: name, description,
 * brand, category; now also SKUs and tags through products.search_text), or
 * the FULLTEXT index in natural-language mode (any word, for relevance).
 *
 * Ranking (when no explicit sort): exact SKU, exact name, the name starting
 * with the phrase, another name word starting with it, the name containing
 * the phrase or every word, then the rest; inside each group by FULLTEXT relevance, then rating, then id.
 *
 * Typos: a word nobody could find is replaced by the closest vocabulary word
 * (see correct()). A word that is in the vocabulary is never corrected.
 */
class CatalogSearch
{
    /** The FULLTEXT index's columns, exactly as the index lists them (MATCH must name the same ones). */
    private const MATCH_SQL = 'MATCH(products.name, products.description, products.search_text) AGAINST (? IN NATURAL LANGUAGE MODE)';

    /** Phase 13: the Bangla (and other) translations' FULLTEXT index (product_translations_search_fulltext). */
    private const TRANSLATION_MATCH_SQL = 'MATCH(product_translations.name, product_translations.description) AGAINST (? IN NATURAL LANGUAGE MODE)';

    /** Words with at least this many letters may be corrected. */
    private const MIN_CORRECTABLE = 4;

    /** At most this many words of a query are looked at for corrections. */
    private const MAX_WORDS = 8;

    /** Narrows $query to products matching $phrase. */
    public function filter(Builder $query, string $phrase): void
    {
        // addcslashes: a search for "%" means the character, not "anything".
        $like = '%'.addcslashes($phrase, '%_\\').'%';
        $fulltext = $this->fulltextQuery($phrase);

        $query->where(fn ($q) => $q->where('products.name', 'like', $like)
            ->orWhere('products.description', 'like', $like)
            ->orWhere('products.search_text', 'like', $like)
            ->orWhereHas('brand', fn ($b) => $b->where('name', 'like', $like))
            ->orWhereHas('category', fn ($c) => $c->where('name', 'like', $like))
            // Phase 13: Bangla names and descriptions (and Bangla category names) are searched too, in any language.
            ->orWhereHas('translations', fn ($t) => $t->where(fn ($t) => $t->where('name', 'like', $like)->orWhere('description', 'like', $like)
                ->when($fulltext !== '' && DB::getDriverName() === 'mysql', fn ($t) => $t->orWhereRaw(self::TRANSLATION_MATCH_SQL, [$fulltext]))))
            ->orWhereHas('category.translations', fn ($c) => $c->where('name', 'like', $like))
            ->when($fulltext !== '', fn ($q) => $q->orWhereRaw(self::MATCH_SQL, [$fulltext])));
    }

    /** Orders $query by relevance to $phrase (used when the shopper didn't choose a sort). */
    public function rank(Builder $query, string $phrase): void
    {
        $phrase = trim(preg_replace('/\s+/u', ' ', $phrase));
        $escaped = addcslashes($phrase, '%_\\');
        $words = array_values(array_unique(SearchIndex::words($phrase)));

        // Phase 13: in another language the tiers use the translated name (the English one when it has none).
        $locale = Locale::current();
        $name = $locale === Locale::FALLBACK ? 'products.name'
            : "COALESCE(NULLIF((SELECT pt.name FROM product_translations pt WHERE pt.product_id = products.id AND pt.locale = ? LIMIT 1), ''), products.name)";
        $nameBindings = $locale === Locale::FALLBACK ? [] : [$locale];
        $allWords = $words
            ? ' OR ('.implode(' AND ', array_fill(0, count($words), "{$name} LIKE ?")).')'
            : '';
        $tier = 'CASE'
            .' WHEN products.sku = ? OR EXISTS (SELECT 1 FROM product_variants WHERE product_variants.product_id = products.id AND product_variants.sku = ?) THEN 0'
            ." WHEN {$name} = ? THEN 1"
            ." WHEN {$name} LIKE ? THEN 2"
            ." WHEN {$name} LIKE ? THEN 3"
            ." WHEN {$name} LIKE ?".$allWords.' THEN 4'
            .' ELSE 5 END';
        $bindings = [$phrase, $phrase, ...$nameBindings, $phrase, ...$nameBindings, $escaped.'%', ...$nameBindings, '% '.$escaped.'%',
            ...$nameBindings, '%'.$escaped.'%',
            ...array_merge(...array_map(fn ($word) => [...$nameBindings, '%'.addcslashes($word, '%_\\').'%'], $words ?: []))];

        $query->orderByRaw($tier, $bindings);
        $fulltext = $this->fulltextQuery($phrase);
        if ($fulltext !== '') {
            $query->orderByRaw(self::MATCH_SQL.' DESC', [$fulltext]);
        }
        $query->orderByDesc('products.rating_average')->orderBy('products.id');
    }

    /**
     * The query with typos corrected, or null when nothing was corrected.
     * $normalized is SearchTerms::normalize()'d; the answer is its words
     * (corrected ones replaced) joined by single spaces.
     *
     * A word is corrected only when it has 4+ letters and no digits, is not a
     * vocabulary word, is not part of one (half-typed words are left alone),
     * and finds no product for sale on its own.
     */
    public function correct(string $normalized, ?CategoryTree $tree = null): ?string
    {
        $words = SearchIndex::words($normalized);
        if ($words === [] || count($words) > self::MAX_WORDS) {
            return null;
        }

        $changed = false;
        foreach (array_unique($words) as $word) {
            $replacement = $this->correctWord($word, $tree);
            if ($replacement !== null) {
                $words = array_map(fn ($w) => $w === $word ? $replacement : $w, $words);
                $changed = true;
            }
        }

        return $changed ? implode(' ', $words) : null;
    }

    /** The vocabulary word to use instead of $word, or null to keep it. */
    public function correctWord(string $word, ?CategoryTree $tree = null): ?string
    {
        $length = mb_strlen($word);
        // Phase 13: Bangla words are never corrected (the vocabulary is English only; see the phase 13 notes).
        if ($length < self::MIN_CORRECTABLE || preg_match('/\p{N}|\p{Bengali}/u', $word)) {
            return null;
        }
        $vocabulary = DB::table('search_vocabulary');
        if ((clone $vocabulary)->where('word', $word)->exists()
            || (clone $vocabulary)->where('word', 'like', '%'.addcslashes($word, '%_\\').'%')->exists()) {
            return null; // a real word (or the start of one): never "corrected"
        }
        // Found on its own (e.g. only in a description or SKU): not a typo either.
        $alone = Product::forSale($tree ?? CategoryTree::load());
        $this->filter($alone, $word);
        if ($alone->exists()) {
            return null;
        }

        $maxDistance = $length >= 8 ? 2 : 1;
        $first = mb_substr($word, 0, 1);
        $best = null;
        $candidates = (clone $vocabulary)->whereBetween('length', [$length - $maxDistance, $length + $maxDistance])->get(['word', 'count']);
        foreach ($candidates as $candidate) {
            $distance = self::distance($word, $candidate->word, $maxDistance);
            if ($distance > $maxDistance) {
                continue;
            }
            // Same first letter first, then the smallest distance, then the most frequent, then A–Z.
            $key = [mb_substr($candidate->word, 0, 1) === $first ? 0 : 1, $distance, -$candidate->count, $candidate->word];
            if ($best === null || $key < $best[0]) {
                $best = [$key, $candidate->word];
            }
        }

        return $best[1] ?? null;
    }

    /**
     * Damerau–Levenshtein distance (optimal string alignment: insertions,
     * deletions, substitutions, and swaps of two neighbouring letters), by
     * characters, not bytes. Stops early once every path is over $limit.
     */
    public static function distance(string $a, string $b, int $limit = PHP_INT_MAX): int
    {
        $s = mb_str_split($a);
        $t = mb_str_split($b);
        $n = count($s);
        $m = count($t);
        if (abs($n - $m) > $limit) {
            return $limit + 1;
        }
        $d = [];
        for ($i = 0; $i <= $n; $i++) {
            $d[$i] = [$i];
        }
        for ($j = 0; $j <= $m; $j++) {
            $d[0][$j] = $j;
        }
        for ($i = 1; $i <= $n; $i++) {
            $rowMin = PHP_INT_MAX;
            for ($j = 1; $j <= $m; $j++) {
                $cost = $s[$i - 1] === $t[$j - 1] ? 0 : 1;
                $d[$i][$j] = min($d[$i - 1][$j] + 1, $d[$i][$j - 1] + 1, $d[$i - 1][$j - 1] + $cost);
                if ($i > 1 && $j > 1 && $s[$i - 1] === $t[$j - 2] && $s[$i - 2] === $t[$j - 1]) {
                    $d[$i][$j] = min($d[$i][$j], $d[$i - 2][$j - 2] + 1);
                }
                $rowMin = min($rowMin, $d[$i][$j]);
            }
            if ($rowMin > $limit) {
                return $limit + 1;
            }
        }

        return $d[$n][$m];
    }

    /** The words for MATCH … AGAINST (letters and digits only, so no operator or quote can sneak in). */
    private function fulltextQuery(string $phrase): string
    {
        return implode(' ', array_slice(SearchIndex::words($phrase), 0, 20));
    }
}
