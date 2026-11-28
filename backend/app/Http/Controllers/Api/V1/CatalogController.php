<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\ProductResource;
use App\Models\Category;
use App\Models\Product;
use App\Services\CatalogSearch;
use App\Services\SearchTerms;
use App\Support\CategoryTree;
use App\Support\Locale;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/** The public catalog: no sign-in, only products for sale (active, in a visible category). */
class CatalogController extends Controller
{
    public function __construct(private SearchTerms $searchTerms, private CatalogSearch $search) {}

    /**
     * GET /api/v1/products?search&category&brand[]&min_price&max_price&min_rating&available
     *     &sort=price|rating|discount|name|newest|best_selling&direction=asc|desc&page&per_page&suggest&correct
     * Prices include catalog price rules for everyone (ProductResource); the price filters and
     * sort use the product's own sale price (rules are matched in PHP, not SQL).
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'suggest' => ['nullable', 'boolean'],
            // Phase 10 (part A): correct=0 searches the words exactly as typed ("Search instead for …").
            'correct' => ['nullable', 'boolean'],
            'category' => ['nullable', 'string', 'max:100'],
            'brand' => ['nullable', 'array', 'max:50'],
            'brand.*' => ['string', 'max:80'],
            'min_price' => ['nullable', 'numeric', 'min:0'],
            'max_price' => ['nullable', 'numeric', 'min:0'],
            'min_rating' => ['nullable', 'numeric', 'min:0', 'max:5'],
            'available' => ['nullable', 'boolean'],
            // Phase 17: best_selling = units sold in the last 90 days (orders not cancelled), then rating, then id.
            'sort' => ['nullable', 'in:price,rating,discount,name,newest,best_selling'],
            'direction' => ['nullable', 'in:asc,desc'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $tree = CategoryTree::load();

        // Phase 10 (part A): typo correction (a word nobody could find becomes the closest
        // vocabulary word), then FULLTEXT matching and relevance ranking (App\Services\CatalogSearch).
        $search = filled($data['search'] ?? null) ? $data['search'] : null;
        $correctedQuery = $search !== null && $request->boolean('correct', true)
            ? $this->search->correct(SearchTerms::normalize($search), $tree)
            : null;
        $phrase = $correctedQuery ?? $search;

        $query = Product::forSale($tree)->with(['category', 'brand', ...Product::CARD_RELATIONS, ...self::translationRelations()])
            ->when($phrase !== null, fn ($query) => $this->search->filter($query, $phrase))
            // A category includes its subcategories' products.
            ->when($data['category'] ?? null, function ($query, $slug) use ($tree) {
                $id = Category::where('slug', $slug)->value('id');
                $query->whereIn('category_id', $id ? $tree->descendantIds($id) : []);
            })
            ->when($data['brand'] ?? null, fn ($query, $brands) => $query->whereHas('brand', fn ($b) => $b->whereIn('name', $brands)))
            ->when(isset($data['min_price']), fn ($query) => $query->whereRaw(Product::SALE_PRICE_SQL.' >= ?', [$data['min_price']]))
            ->when(isset($data['max_price']), fn ($query) => $query->whereRaw(Product::SALE_PRICE_SQL.' <= ?', [$data['max_price']]))
            ->when(isset($data['min_rating']), fn ($query) => $query->where('rating_average', '>=', $data['min_rating']))
            ->when($request->boolean('available'), fn ($query) => $query->where('stock_quantity', '>', 0)
                ->whereColumn('stock_quantity', '>=', 'min_order_quantity'));

        // An explicit sort wins; a search without one is ordered by relevance.
        if ($phrase !== null && empty($data['sort'])) {
            $this->search->rank($query, $phrase);
        } else {
            $this->sort($query, $data['sort'] ?? null, $data['direction'] ?? null);
        }
        // Phase 17: does anything in the whole filtered result have sales? (false: the "best selling" order is only the rating order)
        $hasSales = ($data['sort'] ?? null) === 'best_selling'
            ? (clone $query)->reorder()->where('best_sellers.units_sold', '>', 0)->exists()
            : null;
        $page = $query->paginate($data['per_page'] ?? 12)->withQueryString();
        $products = ProductResource::collection($page);
        $meta = $hasSales === null ? [] : ['has_sales' => $hasSales];

        // Phase 7: search terms. A search is counted (once per visitor per hour) and an exact term with a
        // redirect tells the storefront where to go (meta.redirect_url; null when the term has none).
        if (array_key_exists('search', $data) && filled($data['search'])) {
            $term = SearchTerms::normalize($data['search']);
            // Typing in the search box asks for suggestions on every few letters: those aren't searches.
            if (! $request->boolean('suggest')) {
                $this->searchTerms->record($term, $page->total(), $request->ip());
            }
            $meta += [
                'redirect_url' => $this->searchTerms->redirectFor($term),
                // Phase 10 (part A): what was searched instead ("Showing results for …"), null when nothing was corrected.
                'corrected_query' => $correctedQuery,
            ];
        }
        if ($meta !== []) {
            $products->additional(['meta' => $meta]);
        }

        return $products;
    }

    /**
     * GET /api/v1/products/{id} - drafts, archived, deleted products, and
     * products in a hidden category are "not found". Approved reviews only;
     * options and active variants for configurable products.
     */
    public function show(int $id): ProductResource|JsonResponse
    {
        $product = Product::forSale()->with(['category', 'brand', 'images', 'options.values', 'variants', ...self::translationRelations(),
            'reviews' => fn ($q) => $q->where('status', 'approved'), 'reviews.photos'])->find($id); // phase 22: the photos

        return $product
            ? (new ProductResource($product))->withDetail()->withRecommendations() // phase 11: related and upsells
            : response()->json(['message' => __('Product not found.')], 404);
    }

    /**
     * Phase 11: GET /api/v1/products/compare?ids=1,2,3 (2–4 ids) → { data: [card + description_short, options, specifications] }
     * in the order asked; unknown and hidden products are skipped.
     */
    public function compare(Request $request): JsonResponse
    {
        $raw = (string) $request->query('ids', '');
        $parts = array_filter(array_map('trim', explode(',', $raw)), fn ($part) => $part !== '');
        $ids = array_values(array_unique(array_map('intval', $parts)));
        if (count($parts) === 0 || array_filter($parts, fn ($part) => ! ctype_digit($part)) !== [] || count($ids) < 2 || count($ids) > 4) {
            throw ValidationException::withMessages(['ids' => __('Choose 2 to 4 products to compare.')]);
        }
        $products = Product::forSale()->with(['category', 'brand', ...Product::CARD_RELATIONS, ...self::translationRelations()])->whereIn('id', $ids)->get()->keyBy('id');

        $data = [];
        foreach ($ids as $id) {
            $product = $products->get($id);
            if (! $product) {
                continue;
            }
            $description = trim((string) preg_replace('/\s+/', ' ', strip_tags((string) $product->translated('description'))));
            $data[] = [
                ...(new ProductResource($product))->resolve($request),
                'description_short' => $description === '' ? null : Str::limit($description, 197, '...'),
                'options' => $product->has_variants ? $product->options->map(fn ($option) => [
                    'name' => $option->translatedName(),
                    'values' => $option->values->map(fn ($value) => $value->translatedValue())->values()->all(),
                ])->values()->all() : [],
                'specifications' => $product->specificationList(Locale::current()),
            ];
        }

        return response()->json(['data' => $data]);
    }

    /**
     * GET /api/v1/categories - the visible tree (a category and all its
     * ancestors active), with only the branches that have something to buy.
     * Item: { id, slug, name, image_url, description, meta_title, meta_description, parent_id, children: [...] }.
     */
    public function categories(): JsonResponse
    {
        $tree = CategoryTree::load();
        $counts = Product::forSale($tree)->selectRaw('category_id, COUNT(*) AS n')->groupBy('category_id')->pluck('n', 'category_id');
        $hasProducts = fn (Category $category) => collect($tree->descendantIds($category->id))->contains(fn ($id) => ($counts[$id] ?? 0) > 0);

        $categories = $tree->nested(fn (Category $category) => [
            'id' => $category->id,
            'slug' => $category->slug,
            // Phase 13: in the request language, each field falling back to English; `locale` = the name's language.
            'name' => $category->translated('name'),
            'locale' => $category->translatedLocale('name'),
            'image_url' => $category->image_url,
            'description' => $category->translated('description'),
            'meta_title' => $category->translated('meta_title'),
            'meta_description' => $category->translated('meta_description'),
            'parent_id' => $category->parent_id,
        ], fn (Category $category) => $category->is_active && $hasProducts($category));

        return response()->json(['data' => $categories]);
    }

    /** Phase 13: the translations a Bangla answer needs (nothing extra in English). */
    public static function translationRelations(): array
    {
        return Locale::isBangla() ? ['translations', 'category.translations'] : [];
    }

    /** Without a sort: the catalog's own order (by id). Ties always fall back to the id, so pages never overlap. */
    private function sort($query, ?string $sort, ?string $direction): void
    {
        // Sensible defaults: cheapest and A–Z first; best rated, biggest discount, newest, and best selling first.
        $direction ??= in_array($sort, ['price', 'name'], true) ? 'asc' : 'desc';

        match ($sort) {
            'price' => $query->orderByRaw(Product::SALE_PRICE_SQL.' '.$direction),
            'rating' => $query->orderBy('rating_average', $direction),
            'discount' => $query->orderBy('discount_percent', $direction),
            'name' => $query->orderBy('name', $direction),
            'newest' => $query->orderBy('created_at', $direction),
            'best_selling' => $query->orderByBestSelling($direction), // phase 17 (joins a grouped subquery: ids qualified below)
            default => null,
        };
        $query->orderBy('products.id', $sort === 'newest' ? $direction : 'asc');
    }
}
