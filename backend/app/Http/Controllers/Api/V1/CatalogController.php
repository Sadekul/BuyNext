<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\ProductResource;
use App\Models\Category;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/** The public catalog: no sign-in, only `active` products. */
class CatalogController extends Controller
{
    /**
     * GET /api/v1/products?search&category&brand[]&min_price&max_price&min_rating&available
     *     &sort=price|rating|discount|name|newest&direction=asc|desc&page&per_page
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'category' => ['nullable', 'string', 'max:100'],
            'brand' => ['nullable', 'array', 'max:50'],
            'brand.*' => ['string', 'max:80'],
            'min_price' => ['nullable', 'numeric', 'min:0'],
            'max_price' => ['nullable', 'numeric', 'min:0'],
            'min_rating' => ['nullable', 'numeric', 'min:0', 'max:5'],
            'available' => ['nullable', 'boolean'],
            'sort' => ['nullable', 'in:price,rating,discount,name,newest'],
            'direction' => ['nullable', 'in:asc,desc'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = Product::active()->with(['category', 'brand'])
            ->when($data['search'] ?? null, function ($query, $search) {
                // addcslashes: a search for "%" means the character, not "anything".
                $like = '%'.addcslashes($search, '%_\\').'%';
                $query->where(fn ($q) => $q->where('name', 'like', $like)->orWhere('description', 'like', $like)
                    ->orWhereHas('brand', fn ($b) => $b->where('name', 'like', $like))
                    ->orWhereHas('category', fn ($c) => $c->where('name', 'like', $like)));
            })
            ->when($data['category'] ?? null, fn ($query, $slug) => $query->whereHas('category', fn ($c) => $c->where('slug', $slug)))
            ->when($data['brand'] ?? null, fn ($query, $brands) => $query->whereHas('brand', fn ($b) => $b->whereIn('name', $brands)))
            ->when(isset($data['min_price']), fn ($query) => $query->whereRaw(Product::SALE_PRICE_SQL.' >= ?', [$data['min_price']]))
            ->when(isset($data['max_price']), fn ($query) => $query->whereRaw(Product::SALE_PRICE_SQL.' <= ?', [$data['max_price']]))
            ->when(isset($data['min_rating']), fn ($query) => $query->where('rating_average', '>=', $data['min_rating']))
            ->when($request->boolean('available'), fn ($query) => $query->where('stock_quantity', '>', 0)
                ->whereColumn('stock_quantity', '>=', 'min_order_quantity'));

        $this->sort($query, $data['sort'] ?? null, $data['direction'] ?? null);

        return ProductResource::collection($query->paginate($data['per_page'] ?? 12)->withQueryString());
    }

    /** GET /api/v1/products/{id} - drafts, archived, and deleted products are "not found". */
    public function show(int $id): ProductResource|JsonResponse
    {
        $product = Product::active()->with(['category', 'brand', 'images', 'reviews'])->find($id);

        return $product
            ? (new ProductResource($product))->withDetail()
            : response()->json(['message' => 'Product not found.'], 404);
    }

    /** GET /api/v1/categories - only categories that have something to buy. */
    public function categories(): JsonResponse
    {
        $categories = Category::whereHas('products', fn ($q) => $q->active())
            ->orderBy('position')->orderBy('name')
            ->get(['slug', 'name', 'image_url']);

        return response()->json(['data' => $categories]);
    }

    /** Without a sort: the catalog's own order (by id). Ties always fall back to the id, so pages never overlap. */
    private function sort($query, ?string $sort, ?string $direction): void
    {
        // Sensible defaults: cheapest and A–Z first; best rated, biggest discount, and newest first.
        $direction ??= in_array($sort, ['price', 'name'], true) ? 'asc' : 'desc';

        match ($sort) {
            'price' => $query->orderByRaw(Product::SALE_PRICE_SQL.' '.$direction),
            'rating' => $query->orderBy('rating_average', $direction),
            'discount' => $query->orderBy('discount_percent', $direction),
            'name' => $query->orderBy('name', $direction),
            'newest' => $query->orderBy('created_at', $direction),
            default => null,
        };
        $query->orderBy('id', $sort === 'newest' ? $direction : 'asc');
    }
}
