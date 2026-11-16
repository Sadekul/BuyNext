<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminArrayResource;
use App\Models\SearchTerm;
use App\Services\Audit;
use App\Services\SearchTerms;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/**
 * Search terms (phase 7): the report (Reports → Search terms, reports.view)
 * and the per-term redirects (Content → Search terms, seo.manage).
 */
class SearchTermController extends Controller
{
    public function __construct(private Audit $audit) {}

    /** GET /api/admin/v1/reports/search-terms?type=top|zero&search&page&per_page - most hits first. */
    public function report(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'type' => ['nullable', Rule::in(['top', 'zero'])],
            'search' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $terms = $this->query($data)
            ->when(($data['type'] ?? 'top') === 'zero', fn ($query) => $query->where('last_results_count', 0))
            ->paginate($data['per_page'] ?? 20)->withQueryString();

        return AdminArrayResource::collection($terms);
    }

    /** GET /api/admin/v1/search-terms?search&has_redirect&page&per_page - most hits first. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'has_redirect' => ['nullable', 'boolean'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $terms = $this->query($data)
            ->when($request->has('has_redirect'), fn ($query) => $request->boolean('has_redirect')
                ? $query->whereNotNull('redirect_url') : $query->whereNull('redirect_url'))
            ->paginate($data['per_page'] ?? 20)->withQueryString();

        return AdminArrayResource::collection($terms);
    }

    /** POST /api/admin/v1/search-terms { term, redirect_url } → 201 (a redirect for a term nobody searched yet). */
    public function store(Request $request): JsonResponse
    {
        if ($request->has('term')) {
            $request->merge(['term' => SearchTerms::normalize((string) $request->input('term'))]);
        }
        $data = $request->validate([
            'term' => ['required', 'string', 'max:'.SearchTerms::MAX_LENGTH, Rule::unique('search_terms', 'term')],
            ...$this->redirectRules(),
        ], [
            'term.required' => 'Enter a search term.',
            'term.unique' => 'This term is already listed. Edit it instead.',
            ...$this->redirectMessages(),
        ]);

        $term = SearchTerm::create(['term' => $data['term'], 'redirect_url' => $data['redirect_url'] ?? null]);
        $this->audit->record('search_term.created', "Search term \"{$term->term}\" added.", 'search_term', $term->id,
            Audit::created(['term' => $term->term, 'redirect_url' => $term->redirect_url]));

        return response()->json(['data' => $term->fresh()->toAdminArray()], 201);
    }

    /** PATCH /api/admin/v1/search-terms/{id} { redirect_url } (null clears it). */
    public function update(Request $request, int $id): JsonResponse
    {
        $term = SearchTerm::find($id);
        if (! $term) {
            return $this->notFound();
        }
        $data = $request->validate(['redirect_url' => ['present', ...$this->redirectRules()['redirect_url']]], $this->redirectMessages());

        $before = ['redirect_url' => $term->redirect_url];
        $term->forceFill(['redirect_url' => $data['redirect_url'] ?? null])->save();
        if ($changes = Audit::diff($before, ['redirect_url' => $term->redirect_url])) {
            $this->audit->record('search_term.updated', "Search term \"{$term->term}\" updated.", 'search_term', $term->id, $changes);
        }

        return response()->json(['data' => $term->fresh()->toAdminArray()]);
    }

    /** DELETE /api/admin/v1/search-terms/{id} → 204 (its count starts again with the next search). */
    public function destroy(int $id): JsonResponse
    {
        $term = SearchTerm::find($id);
        if (! $term) {
            return $this->notFound();
        }
        $this->audit->record('search_term.deleted', "Search term \"{$term->term}\" deleted.", 'search_term', $term->id,
            Audit::deleted(['term' => $term->term, 'hits' => $term->hits, 'redirect_url' => $term->redirect_url]));
        $term->delete();

        return response()->json(null, 204);
    }

    private function query(array $data)
    {
        return SearchTerm::query()
            ->when($data['search'] ?? null, fn ($query, $search) => $query->where('term', 'like', '%'.addcslashes(mb_strtolower($search), '%_\\').'%'))
            ->orderByDesc('hits')->orderBy('term');
    }

    /** A store path ("/sale", not "//host") or an https:// URL. */
    private function redirectRules(): array
    {
        return ['redirect_url' => ['nullable', 'string', 'max:2048', 'regex:#^(/(?!/)\S*|https://[^\s/]+\S*)$#']];
    }

    private function redirectMessages(): array
    {
        return ['redirect_url.regex' => 'Enter a store path starting with / (for example /sale) or an https:// address.'];
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Search term not found.'], 404);
    }
}
