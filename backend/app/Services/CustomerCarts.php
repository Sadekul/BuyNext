<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\CustomerCart;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Support\CategoryTree;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Collection;

/**
 * Phase 7: the saved carts of signed-in customers. The storefront keeps the
 * cart in the browser; the server saves a copy each time it validates the
 * cart (CartController), so the cart follows the customer to another
 * device (GET /me/cart, POST /me/cart/merge) and staff can see abandoned
 * carts (Reports → Abandoned carts) and send a reminder.
 */
class CustomerCarts
{
    public const MAX_QUANTITY = 999;

    /**
     * Saves what was just validated. $items: [{ product_id, variant_id?, quantity }];
     * $subtotalCents: the validated subtotal. An empty cart deletes the row.
     */
    public function save(Customer $customer, array $items, int $subtotalCents): void
    {
        $items = $this->normalize($items);
        if ($items === []) {
            CustomerCart::where('customer_id', $customer->id)->delete();

            return;
        }

        $values = [
            'items' => $items,
            'subtotal' => Pricing::format($subtotalCents),
            'item_count' => array_sum(array_column($items, 'quantity')),
            'converted_at' => null, // a cart with items after an order is a new cart
        ];
        try {
            $this->write(CustomerCart::firstOrNew(['customer_id' => $customer->id]), $values);
        } catch (UniqueConstraintViolationException) {
            // Two price checks at the same moment (checkout asks again when the address or payment changes):
            // both found no saved cart and both tried to add one. The other request's row is there now: update it.
            // (Found in phase 23's browser runs: the losing request answered 500, so the order couldn't be placed.)
            $this->write(CustomerCart::where('customer_id', $customer->id)->firstOrFail(), $values);
        }
    }

    private function write(CustomerCart $cart, array $values): void
    {
        $cart->fill($values);
        $cart->updated_at = now(); // moves even when nothing changed: the customer is still shopping
        $cart->save();
    }

    /** The customer placed an order: their saved cart was bought. */
    public function markConverted(int $customerId): void
    {
        CustomerCart::where('customer_id', $customerId)->whereNull('converted_at')->update(['converted_at' => now()]);
    }

    /**
     * GET /me/cart: the saved items still for sale, each capped by today's
     * stock (sold-out items left out). { items, item_count, updated_at }.
     */
    public function restore(Customer $customer): array
    {
        $cart = CustomerCart::where('customer_id', $customer->id)->whereNull('converted_at')->first();
        $items = $cart ? $this->capped($cart->items ?? []) : [];

        return [
            'items' => $items,
            'item_count' => array_sum(array_column($items, 'quantity')),
            'updated_at' => $cart?->updated_at?->toIso8601ZuluString(),
        ];
    }

    /**
     * POST /me/cart/merge: adds the browser's items to the saved cart (same
     * product + variant: quantities added), capped by stock, and saves it.
     */
    public function merge(Customer $customer, array $local): array
    {
        $cart = CustomerCart::where('customer_id', $customer->id)->whereNull('converted_at')->first();
        $merged = $this->capped($this->normalize([...($cart->items ?? []), ...$local]));

        if ($merged === []) {
            CustomerCart::where('customer_id', $customer->id)->delete();
        } else {
            $subtotal = $this->lines($merged)->sum(fn (array $line) => $line['sale_cents'] * $line['quantity']);
            $this->save($customer, $merged, $subtotal);
        }

        return $this->restore($customer);
    }

    /**
     * The saved items with today's product data, for the report and the
     * reminder email: [{ product_id, variant_id, name, variant_label, sku,
     * thumbnail_url, quantity, sale_cents, available, stock }].
     */
    public function lines(array $items): Collection
    {
        $products = Product::withTrashed()->with('options.values')->whereIn('id', array_column($items, 'product_id'))->get()->keyBy('id');
        $variantIds = array_filter(array_column($items, 'variant_id'));
        $variants = $variantIds ? ProductVariant::whereIn('id', $variantIds)->get()->keyBy('id') : collect();
        $tree = CategoryTree::load();

        return collect($items)->map(function (array $item) use ($products, $variants, $tree) {
            $product = $products->get($item['product_id']);
            if (! $product) {
                return null;
            }
            $variant = $item['variant_id'] ? $variants->get($item['variant_id']) : null;
            if ($variant && $variant->product_id !== $product->id) {
                $variant = null;
            }
            $stock = $variant ? $variant->stock_quantity : $product->stock_quantity;
            $sellable = $product->isForSale($tree) && ($product->has_variants ? ($variant && $variant->is_active) : true);

            return [
                'product_id' => $product->id,
                'variant_id' => $variant?->id,
                'name' => $product->name,
                'variant_label' => $variant ? $variant->label($product->optionValueMap()) : null,
                'sku' => $variant->sku ?? $product->sku,
                'thumbnail_url' => $product->thumbnail_url,
                'quantity' => (int) $item['quantity'],
                'sale_cents' => $variant ? $variant->salePriceCents($product) : $product->salePriceCents(),
                'available' => $sellable && $stock > 0,
                'stock' => (int) $stock,
            ];
        })->filter()->values();
    }

    /** Same product + variant merged, quantities 1–999, at most 50 lines. */
    private function normalize(array $items): array
    {
        $merged = [];
        foreach ($items as $item) {
            $productId = (int) ($item['product_id'] ?? 0);
            $variantId = isset($item['variant_id']) && $item['variant_id'] ? (int) $item['variant_id'] : null;
            $quantity = (int) ($item['quantity'] ?? 0);
            // Phase 10 (part B): gift card lines (amount + recipient) stay in the browser's cart only.
            if ($productId < 1 || $quantity < 1 || ! empty($item['gift_card'])) {
                continue;
            }
            $key = $productId.':'.($variantId ?? 0);
            $merged[$key] ??= ['product_id' => $productId, 'variant_id' => $variantId, 'quantity' => 0];
            $merged[$key]['quantity'] = min(self::MAX_QUANTITY, $merged[$key]['quantity'] + $quantity);
        }

        return array_slice(array_values($merged), 0, 50);
    }

    /** Only lines still for sale and in stock, each quantity capped by the stock. */
    private function capped(array $items): array
    {
        return $this->lines($this->normalize($items))
            ->filter(fn (array $line) => $line['available'])
            ->map(fn (array $line) => [
                'product_id' => $line['product_id'],
                'variant_id' => $line['variant_id'],
                'quantity' => min($line['quantity'], $line['stock'], self::MAX_QUANTITY),
            ])->values()->all();
    }
}
