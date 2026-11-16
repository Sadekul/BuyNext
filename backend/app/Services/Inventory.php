<?php

namespace App\Services;

use App\Models\Product;
use App\Models\ProductVariant;

/**
 * Puts units back in stock (a cancelled order, a credit memo with "restock").
 * A line that was sold as a variant goes back to that variant; the product's
 * stock (the sum of its active variants) follows. Call inside a transaction:
 * rows are locked in id order (products, then variants) like checkout, so
 * the two can't deadlock.
 */
class Inventory
{
    /**
     * $lines: [['product_id' => ?int, 'variant_id' => ?int, 'quantity' => int], ...].
     * $withTrashed: also restock deleted products (cancelling does; refunds don't).
     */
    public function restock(array $lines, bool $withTrashed = false): void
    {
        $productIds = collect($lines)->pluck('product_id')->filter()->unique()->sort()->values();
        $variantIds = collect($lines)->pluck('variant_id')->filter()->unique()->sort()->values();
        if ($productIds->isEmpty()) {
            return;
        }

        $query = $withTrashed ? Product::withTrashed() : Product::query();
        $products = $query->whereIn('id', $productIds)->orderBy('id')->lockForUpdate()->get()->keyBy('id');
        $variants = $variantIds->isEmpty() ? collect()
            : ProductVariant::whereIn('id', $variantIds)->orderBy('id')->lockForUpdate()->get()->keyBy('id');

        $touched = [];
        foreach ($lines as $line) {
            $product = $products->get($line['product_id']);
            if (! $product || $line['quantity'] <= 0) {
                continue;
            }
            $variant = $line['variant_id'] ? $variants->get($line['variant_id']) : null;
            if ($variant && $variant->product_id === $product->id) {
                $variant->increment('stock_quantity', $line['quantity']);
                $touched[$product->id] = $product;
            } else {
                $product->increment('stock_quantity', $line['quantity']);
            }
        }
        foreach ($touched as $product) {
            $product->syncVariantStock();
        }
    }
}
