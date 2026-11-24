<?php

namespace App\Services;

use App\Http\Controllers\Api\V1\CatalogController;
use App\Http\Resources\ProductResource;
use App\Models\Product;
use App\Models\ProductLink;
use App\Support\CategoryTree;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Phase 11: Magento product links (related products, up-sells, cross-sells)
 * and what the storefront shows from them. Shoppers only ever see products
 * that are for sale; in-stock products come first.
 */
class ProductLinks
{
    public const MAX_RELATED = 8;

    public const MAX_UPSELLS = 4;

    public const MAX_CROSS_SELLS = 4;

    /** Storefront "Related products": the related links, or (none visible) the same category, best rated. */
    public function related(Product $product, Request $request): array
    {
        $linked = $this->linked($product, 'related', self::MAX_RELATED);
        if ($linked->isNotEmpty()) {
            return $this->cards($linked, $request);
        }
        $fallback = Product::forSale()->with(['category', 'brand', ...Product::CARD_RELATIONS, ...CatalogController::translationRelations()])
            ->where('category_id', $product->category_id)->whereKeyNot($product->id)
            ->orderByDesc('rating_average')->orderBy('id')->limit(self::MAX_RELATED)->get();

        return $this->cards($fallback, $request);
    }

    /** Storefront "You may also like". */
    public function upsells(Product $product, Request $request): array
    {
        return $this->cards($this->linked($product, 'upsell', self::MAX_UPSELLS), $request);
    }

    /**
     * Cart "Customers also bought": cross-sells of the cart's products, not in
     * the cart, ordered by how many cart products point to them, then the
     * smallest position, then id.
     */
    public function crossSells(array $cartProductIds, Request $request): array
    {
        $cartProductIds = array_values(array_unique(array_map('intval', $cartProductIds)));
        if ($cartProductIds === []) {
            return [];
        }
        $links = ProductLink::where('type', 'crosssell')->whereIn('product_id', $cartProductIds)
            ->whereNotIn('linked_product_id', $cartProductIds)->get(['linked_product_id', 'position']);
        if ($links->isEmpty()) {
            return [];
        }
        $stats = $links->groupBy('linked_product_id')->map(fn (Collection $rows) => [$rows->count(), $rows->min('position')]);
        $products = Product::forSale()->with(['category', 'brand', ...Product::CARD_RELATIONS, ...CatalogController::translationRelations()])->whereIn('id', $stats->keys())->get()
            ->sortBy(fn (Product $p) => [-$stats[$p->id][0], $stats[$p->id][1], $p->id])->take(self::MAX_CROSS_SELLS)->values();

        return $this->cards($products, $request);
    }

    /** Admin: { related: [entry], upsell: [entry], crosssell: [entry] }, entry { id, name, sku, image, status }. */
    public function forAdmin(Product $product): array
    {
        $links = ProductLink::where('product_id', $product->id)->with('linked')->orderBy('position')->orderBy('id')->get();
        $result = array_fill_keys(ProductLink::TYPES, []);
        foreach ($links as $link) {
            if ($link->linked) { // deleted products are left out
                $result[$link->type][] = [
                    'id' => $link->linked->id,
                    'name' => $link->linked->name,
                    'sku' => $link->linked->sku,
                    'image' => $link->linked->thumbnail_url,
                    'status' => $link->linked->status,
                ];
            }
        }

        return $result;
    }

    /** Ids per type, for copying (duplicate) and CSV export. */
    public function idsByType(Product $product): array
    {
        $result = array_fill_keys(ProductLink::TYPES, []);
        foreach (ProductLink::where('product_id', $product->id)->orderBy('position')->orderBy('id')->get() as $link) {
            $result[$link->type][] = $link->linked_product_id;
        }

        return $result;
    }

    /** Replaces the lists given in $links (type => ordered ids); types left out are unchanged. Ids must be valid already. */
    public function sync(Product $product, array $links): void
    {
        DB::transaction(function () use ($product, $links) {
            foreach (ProductLink::TYPES as $type) {
                if (! array_key_exists($type, $links) || $links[$type] === null) {
                    continue;
                }
                ProductLink::where('product_id', $product->id)->where('type', $type)->delete();
                foreach (array_values(array_unique(array_map('intval', $links[$type]))) as $position => $id) {
                    if ($id !== $product->id) {
                        ProductLink::create(['product_id' => $product->id, 'linked_product_id' => $id, 'type' => $type, 'position' => $position]);
                    }
                }
            }
        });
    }

    /** Visible linked products of $type, in stock first, then position. */
    private function linked(Product $product, string $type, int $limit): Collection
    {
        $tree = CategoryTree::load();

        return Product::forSale($tree)->with(['category', 'brand', ...Product::CARD_RELATIONS, ...CatalogController::translationRelations()])
            ->join('product_links', 'product_links.linked_product_id', '=', 'products.id')
            ->where('product_links.product_id', $product->id)->where('product_links.type', $type)
            ->select('products.*')
            ->tap(fn (Builder $query) => $query->orderByRaw("(products.type = 'gift_card' OR products.stock_quantity > 0) DESC"))
            ->orderBy('product_links.position')->orderBy('products.id')
            ->limit($limit)->get();
    }

    private function cards(Collection $products, Request $request): array
    {
        return $products->map(fn (Product $product) => (new ProductResource($product))->resolve($request))->values()->all();
    }
}
