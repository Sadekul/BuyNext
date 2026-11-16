<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AdminRole;
use App\Models\AuditLog;
use App\Models\SearchTerm;
use App\Services\SearchTerms;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 7: search terms recorded by the catalog search, the report, and per-term redirects. */
class SearchTermTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = $this->adminHeaders();
        $this->product(['name' => 'Red Running Shoe']);
        $this->product(['name' => 'Blue Running Shoe']);
    }

    private function search(string $term, string $ip = '203.0.113.5')
    {
        $this->app['auth']->forgetGuards();

        return $this->withServerVariables(['REMOTE_ADDR' => $ip])->getJson('/api/v1/products?search='.urlencode($term))->assertOk();
    }

    public function test_terms_are_normalized_and_counted_once_per_visitor_per_hour(): void
    {
        $this->assertSame('running shoe', SearchTerms::normalize("  Running \t  SHOE "));
        $this->assertSame(100, mb_strlen(SearchTerms::normalize(str_repeat('é', 150))));

        $this->search('Running Shoe')->assertJsonPath('meta.total', 2)->assertJsonPath('meta.redirect_url', null);
        $this->search('  running   shoe ');                 // the same visitor, the same term: not counted again
        $this->search('running shoe', '198.51.100.7');      // another visitor
        $this->search('wizard hat');                         // no results

        $this->assertSame(
            [['running shoe', 2, 2], ['wizard hat', 1, 0]],
            SearchTerm::orderBy('term')->get()->map(fn ($t) => [$t->term, $t->hits, $t->last_results_count])->all(),
        );

        // An hour later the same visitor counts again; no search term → nothing recorded and no redirect key.
        $this->travel(61)->minutes();
        $this->search('running shoe');
        $this->assertSame(3, SearchTerm::where('term', 'running shoe')->value('hits'));
        $this->getJson('/api/v1/products')->assertOk()->assertJsonMissingPath('meta.redirect_url');
        $this->assertSame(2, SearchTerm::count());

        // Search-box suggestions (typed letter by letter) answer normally but aren't recorded.
        $this->getJson('/api/v1/products?search=runn&suggest=1')->assertOk()->assertJsonPath('meta.total', 2);
        $this->assertSame(2, SearchTerm::count());
    }

    public function test_an_exact_term_with_a_redirect_answers_its_url(): void
    {
        $this->search('sale');
        $term = SearchTerm::sole();
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/search-terms/{$term->id}", ['redirect_url' => '/pages/black-friday'])->assertOk()
            ->assertJsonPath('data.redirect_url', '/pages/black-friday');

        $this->search(' SALE ')->assertJsonPath('meta.redirect_url', '/pages/black-friday');
        $this->search('sales')->assertJsonPath('meta.redirect_url', null);

        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/search-terms/{$term->id}", ['redirect_url' => null])->assertOk();
        $this->search('sale')->assertJsonPath('meta.redirect_url', null);
    }

    public function test_staff_report_and_manage_terms(): void
    {
        $this->search('running shoe');
        $this->search('running shoe', '198.51.100.7');
        $this->search('wizard hat');

        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/reports/search-terms')->assertOk()
            ->assertJsonPath('data.0.term', 'running shoe')->assertJsonPath('data.0.hits', 2)->assertJsonPath('meta.total', 2);
        $zero = $this->asAdmin($this->admin, 'GET', '/api/admin/v1/reports/search-terms?type=zero')->assertOk()->assertJsonCount(1, 'data');
        $this->assertSame(['id', 'term', 'hits', 'last_results_count', 'redirect_url', 'created_at', 'updated_at'], array_keys($zero->json('data.0')));
        $zero->assertJsonPath('data.0.term', 'wizard hat');

        // A redirect for a term nobody searched yet; validation.
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/search-terms', ['term' => ' Gift Cards ', 'redirect_url' => 'https://gifts.example.com/'])
            ->assertCreated()->assertJsonPath('data.term', 'gift cards')->assertJsonPath('data.hits', 0);
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/search-terms', ['term' => 'GIFT CARDS', 'redirect_url' => '//evil.example'])
            ->assertUnprocessable()->assertJsonValidationErrors(['term', 'redirect_url']);
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/search-terms', ['term' => 'x', 'redirect_url' => 'http://plain.example'])
            ->assertUnprocessable()->assertJsonValidationErrors('redirect_url');
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/search-terms?has_redirect=1')->assertOk()->assertJsonCount(1, 'data');

        $id = SearchTerm::where('term', 'wizard hat')->value('id');
        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/search-terms/{$id}")->assertNoContent();
        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/search-terms/{$id}")->assertNotFound();
        $this->assertSame(['search_term.created', 'search_term.deleted'], AuditLog::where('subject_type', 'search_term')->orderBy('id')->pluck('action')->all());

        // Permissions: Viewer sees the report but can't set redirects; Marketing (seo.manage) can.
        $viewer = $this->signInAdmin(Admin::factory()->create(['role_id' => AdminRole::where('name', 'Viewer')->value('id')]));
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/reports/search-terms')->assertOk();
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/search-terms')->assertForbidden()->assertJsonPath('permission', 'seo.manage');
        $marketing = $this->signInAdmin(Admin::factory()->create(['role_id' => AdminRole::where('name', 'Marketing')->value('id')]));
        $this->asAdmin($marketing, 'GET', '/api/admin/v1/search-terms')->assertOk();
    }
}
