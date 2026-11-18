<?php

namespace Tests\Feature;

use App\Jobs\RebuildSearchVocabulary;
use App\Models\Brand;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\SearchTerm;
use App\Services\CatalogSearch;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Phase 10 (part A): ranked, typo-tolerant search.
 *
 * Note: InnoDB's FULLTEXT index only sees committed rows, and every test
 * runs inside a transaction, so MATCH() finds nothing here: these tests
 * check the matching that doesn't depend on it (phrase, SKU, tags), the
 * ranking groups, rating as the tie-break, and corrections.
 */
class SearchTest extends TestCase
{
    use RefreshDatabase;

    private Category $category;

    protected function setUp(): void
    {
        parent::setUp();
        $this->category = Category::factory()->create(['name' => 'Gadgets', 'slug' => 'gadgets']);
    }

    private function product(string $name, array $attributes = []): Product
    {
        return Product::factory()->create(['name' => $name, 'description' => 'Plain text.', 'category_id' => $this->category->id, ...$attributes]);
    }

    private function search(string $query): array
    {
        $this->app['auth']->forgetGuards();

        return $this->getJson('/api/v1/products?'.$query)->assertOk()->json();
    }

    private function names(string $query): array
    {
        return array_column($this->search($query)['data'], 'name');
    }

    private function reindex(): void
    {
        $this->artisan('buynest:search:reindex')->assertSuccessful();
    }

    public function test_the_fulltext_index_and_the_reindex_command(): void
    {
        $index = collect(DB::select("SHOW INDEX FROM products WHERE Key_name = 'products_search_fulltext'"));
        $this->assertSame('FULLTEXT', $index->first()->Index_type);
        $this->assertSame(['name', 'description', 'search_text'], $index->sortBy('Seq_in_index')->pluck('Column_name')->values()->all());

        $brand = Brand::factory()->create(['name' => 'Acme']);
        $product = $this->product('Desk Lamp', ['brand_id' => $brand->id, 'sku' => 'LMP-1', 'tags' => ['lighting', 'office']]);
        $this->assertSame('Acme Gadgets lighting office LMP-1', $product->fresh()->search_text);
        ProductVariant::create(['product_id' => $product->id, 'sku' => 'LMP-1-RED', 'option_value_ids' => [], 'option_key' => 'red']);
        $this->assertSame('Acme Gadgets lighting office LMP-1 LMP-1-RED', $product->fresh()->search_text);
        $brand->update(['name' => 'Acme Lights']);
        $this->assertStringStartsWith('Acme Lights Gadgets', $product->fresh()->search_text);

        $this->product('Hidden Draft Gizmo', ['status' => 'draft']);
        $this->artisan('buynest:search:reindex')->expectsOutput('Search index rebuilt: 2 products, 7 words.')->assertSuccessful();
        $this->assertSame(
            ['acme' => 1, 'desk' => 1, 'gadgets' => 1, 'lamp' => 1, 'lighting' => 1, 'lights' => 1, 'office' => 1],
            DB::table('search_vocabulary')->orderBy('word')->pluck('count', 'word')->all(),
        ); // the draft's words are not there: corrections never reveal unpublished products
    }

    public function test_sku_variant_sku_and_tags_are_searchable(): void
    {
        $lamp = $this->product('Desk Lamp', ['sku' => 'LMP-100', 'tags' => ['waterproof']]);
        ProductVariant::create(['product_id' => $lamp->id, 'sku' => 'LMP-100-BLUE', 'option_value_ids' => [], 'option_key' => 'blue']);
        $this->product('Camp Chair', ['sku' => 'CHR-200']);

        $this->assertSame(['Desk Lamp'], $this->names('search=lmp-100'));
        $this->assertSame(['Desk Lamp'], $this->names('search=LMP-100-BLUE'));
        $this->assertSame(['Desk Lamp'], $this->names('search=waterproof'));
    }

    public function test_ranking_exact_sku_then_exact_name_then_name_matches_then_the_rest_by_rating(): void
    {
        $this->product('Reading Light', ['description' => 'A lamp for reading.', 'rating_average' => '5.00']); // description only
        $this->product('Superlamp Deluxe', ['rating_average' => '4.00']);       // the name contains it
        $this->product('Desk Lamp', ['rating_average' => '2.00']);              // a name word starts with it
        $this->product('Floor Lamp', ['rating_average' => '3.00']);             // same group, better rated
        $this->product('Lamp Shade', ['rating_average' => '1.00']);             // the name starts with it
        $this->product('Lamp', ['rating_average' => '0.50']);                   // exact name
        $this->product('Bulb Pack', ['sku' => 'LAMP', 'rating_average' => '0.00']); // exact SKU

        $this->assertSame(['Bulb Pack', 'Lamp', 'Lamp Shade', 'Floor Lamp', 'Desk Lamp', 'Superlamp Deluxe', 'Reading Light'], $this->names('search=lamp'));

        // Every word in the name ranks with the name matches, before a better-rated description match.
        $this->product('Lamp for the Desk, Adjustable', ['description' => 'The best desk lamp.', 'rating_average' => '0.00']);
        $this->product('Office Kit', ['description' => 'Includes a desk lamp.', 'rating_average' => '5.00']);
        $this->assertSame(['Desk Lamp', 'Lamp for the Desk, Adjustable', 'Office Kit'], $this->names('search=desk+lamp'));

        // An explicit sort wins over relevance.
        $this->assertSame(['Bulb Pack', 'Desk Lamp', 'Floor Lamp', 'Lamp', 'Lamp for the Desk, Adjustable', 'Lamp Shade', 'Office Kit', 'Reading Light', 'Superlamp Deluxe'],
            $this->names('search=lamp&sort=name'));
    }

    public function test_a_typo_is_corrected_and_the_answer_says_so(): void
    {
        $this->product('iPhone 13 Pro');
        $this->product('Silicone Case for iPhone');
        $this->reindex();

        $answer = $this->search('search=Ihpone');
        $this->assertSame('iphone', $answer['meta']['corrected_query']);
        $this->assertSame(['iPhone 13 Pro', 'Silicone Case for iPhone'], array_column($answer['data'], 'name'));
        $this->assertNull($answer['meta']['redirect_url']);

        // Several words: only the unknown one changes; the term recorded is what the shopper typed.
        $this->assertSame('iphone case', $this->search('search=ihpone+case')['meta']['corrected_query']);
        $this->assertSame(['ihpone', 'ihpone case'], SearchTerm::orderBy('term')->pluck('term')->all());
        $this->assertSame(2, SearchTerm::where('term', 'ihpone')->value('last_results_count'));

        // "Search instead for ihpone": no correction, no results.
        $exact = $this->search('search=ihpone&correct=0');
        $this->assertNull($exact['meta']['corrected_query']);
        $this->assertSame(0, $exact['meta']['total']);

        // Suggestions are corrected too, and still not recorded.
        $this->assertSame('iphone', $this->search('search=ihpone&suggest=1')['meta']['corrected_query']);
        $this->assertSame(2, SearchTerm::count());

        // Without a search there is no corrected_query key.
        $this->assertArrayNotHasKey('corrected_query', $this->search('per_page=5')['meta']);
    }

    public function test_real_words_are_never_corrected(): void
    {
        $this->product('Desk Lamp', ['description' => 'Bright and waterproof.']);
        $this->product('Camp Chair');
        $this->product('Secret Gadget Prototype', ['status' => 'draft']);
        $this->reindex();

        foreach (['camp' => ['Camp Chair'], 'lamp' => ['Desk Lamp'], 'waterproof' => ['Desk Lamp'], 'chai' => ['Camp Chair']] as $query => $names) {
            $answer = $this->search('search='.$query);
            $this->assertNull($answer['meta']['corrected_query'], $query);
            $this->assertSame($names, array_column($answer['data'], 'name'), $query);
        }

        // Too short, with digits, or nothing close: left alone.
        foreach (['lmp', 'lamp2', 'zebra', 'secrat'] as $query) {
            $this->assertNull($this->search('search='.$query)['meta']['corrected_query'], $query);
        }
    }

    public function test_how_far_a_correction_may_go_and_which_word_wins(): void
    {
        $this->product('Wireless Headphones');
        $this->product('Mascara Black');
        $this->product('Leather Belt');
        $this->product('Leather Belt Brown');
        $this->product('Steel Bolt');
        $this->product('Gilt Frame');
        $this->product('Gilt Mirror');
        $this->product('Gilt Clock');
        $this->reindex();
        $corrected = fn (string $query) => $this->search('search='.$query)['meta']['corrected_query'];

        $this->assertSame('headphones', $corrected('hedphnes'));   // 8+ letters: up to 2 changes
        $this->assertSame('mascara', $corrected('mascrra'));       // 4–7 letters: 1 change
        $this->assertNull($corrected('mscrra'));                   // 2 changes on a short word: no
        $this->assertSame('mascara', $corrected('macsara'));       // two letters swapped count as 1
        // "bilt": belt, bolt and gilt are all 1 away. Same first letter first (not gilt, the most
        // frequent), then the most frequent of those (belt: 2 products, bolt: 1).
        $this->assertSame('belt', $corrected('bilt'));
    }

    public function test_the_distance(): void
    {
        $this->assertSame(0, CatalogSearch::distance('lamp', 'lamp'));
        $this->assertSame(1, CatalogSearch::distance('ihpone', 'iphone'));
        $this->assertSame(1, CatalogSearch::distance('lamp', 'lamps'));
        $this->assertSame(2, CatalogSearch::distance('hedphnes', 'headphones'));
        $this->assertSame(1, CatalogSearch::distance('café', 'cafe')); // characters, not bytes
        $this->assertSame(2, CatalogSearch::distance('abcdef', 'zzzzzz', 1)); // stops early: over the limit
    }

    public function test_the_vocabulary_follows_catalog_changes_once_per_request(): void
    {
        $this->product('Garden Hose');
        $this->assertSame(0, DB::table('search_vocabulary')->count());

        // With the sync queue the rebuild runs once, when the request (or command) ends.
        $this->getJson('/api/v1/categories')->assertOk();
        $this->assertSame(['gadgets', 'garden', 'hose'], DB::table('search_vocabulary')->orderBy('word')->pluck('word')->all());

        $this->product('Garden Rake');
        $this->getJson('/api/v1/categories')->assertOk();
        $this->assertSame(2, DB::table('search_vocabulary')->where('word', 'garden')->value('count'));
    }

    public function test_with_a_real_queue_one_delayed_job_is_queued_for_many_changes(): void
    {
        Queue::fake();
        config(['queue.default' => 'database']);

        $this->product('Garden Hose');
        $this->product('Garden Rake');
        Product::where('name', 'Garden Hose')->first()->update(['name' => 'Garden Hose Pro']);

        Queue::assertPushed(RebuildSearchVocabulary::class, 1);
    }
}
