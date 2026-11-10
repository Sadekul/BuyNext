<?php

namespace App\Services;

use App\Models\Product;
use Illuminate\Support\Collection;

/**
 * The ONE place where money is calculated: cart/validate, checkout, and tests
 * all use it, so a shopper never sees one total in the cart and another at
 * checkout. Everything is in whole cents (ints): 0.1 + 0.2 is not 0.3 with
 * floats.
 *
 * The rounding copies the storefront's display math
 * (frontend/src/utils/pricing.js and cartTotals.js) step by step.
 */
class Pricing
{
    /** "9.99" → 999. Decimal strings from the database have 2 places, so this is exact. */
    public static function toCents(string|int|float $amount): int
    {
        return (int) round((float) $amount * 100);
    }

    /** 999 → "9.99" (the API's money format: a string with 2 decimals). */
    public static function format(int $cents): string
    {
        $sign = $cents < 0 ? '-' : '';
        $cents = abs($cents);

        return $sign.intdiv($cents, 100).'.'.str_pad((string) ($cents % 100), 2, '0', STR_PAD_LEFT);
    }

    /**
     * The price the shopper pays for one unit, in cents:
     * round(price × (1 − discount / 100), 2). Like the storefront, a discount
     * that rounds to 0% (e.g. 0.04%) is ignored. Both sides do the same
     * float steps and round with Math.round (jsRound), so they always agree.
     */
    public static function salePriceCents(string|float $price, string|float $discountPercent): int
    {
        $price = (float) $price;
        $discount = (float) $discountPercent;

        if (self::jsRound($discount) < 1) {
            return self::toCents($price);
        }

        return self::jsRound($price * (1 - $discount / 100) * 100);
    }

    /**
     * JavaScript's Math.round: halves go up (2.5 → 3). PHP's round() differs
     * in edge cases, and floor($x + 0.5) can be off by one because the
     * addition itself rounds; $x - floor($x) is exact.
     */
    public static function jsRound(float $value): int
    {
        $floor = floor($value);

        return (int) ($value - $floor >= 0.5 ? $floor + 1 : $floor);
    }

    /**
     * Prices a cart. $items: [['product_id' => 1, 'quantity' => 2], ...].
     * With $lock (inside a DB transaction) the product rows are locked until
     * the transaction ends, so two checkouts can't sell the same last unit.
     */
    public function quote(array $items, ?string $couponCode, string $shippingMethod, bool $lock = false): CartQuote
    {
        // The same product twice counts as one line (stock is checked on the sum).
        $quantities = [];
        foreach ($items as $item) {
            $id = (int) $item['product_id'];
            $quantities[$id] = ($quantities[$id] ?? 0) + (int) $item['quantity'];
        }

        $products = $this->loadProducts(array_keys($quantities), $lock);

        $lines = [];
        $problems = [];
        foreach ($quantities as $productId => $quantity) {
            $product = $products->get($productId);
            $line = $this->line($productId, $product, $quantity);
            if ($problem = $this->problemWith($product, $quantity)) {
                $problems[] = ['product_id' => $productId, ...$problem];
            }
            $lines[] = $line;
        }

        // Unavailable lines are shown but never charged.
        $charged = array_filter($lines, fn ($line) => $line['available']);
        $itemCount = array_sum(array_column($charged, 'quantity'));
        $subtotal = array_sum(array_column($charged, 'line_cents'));

        [$coupon, $discount, $couponError] = $this->coupon($couponCode, $subtotal);
        $afterDiscount = $subtotal - $discount;
        $freeShipping = $afterDiscount >= config('buynest.store.free_shipping_threshold_cents');

        $options = [];
        foreach (config('buynest.store.shipping_methods') as $id => $method) {
            $options[$id] = [
                'id' => $id,
                'label' => $method['label'],
                'eta' => $method['eta'],
                'price_cents' => $method['free_over_threshold'] && $freeShipping ? 0 : $method['price_cents'],
            ];
        }
        $method = $options[$shippingMethod] ?? $options['standard'];
        $shipping = $itemCount > 0 ? $method['price_cents'] : 0;
        $tax = $itemCount > 0 ? config('buynest.store.tax_cents') : 0;

        return new CartQuote(
            lines: $lines,
            problems: $problems,
            coupon: $coupon,
            couponError: $couponError,
            shippingMethod: $method,
            shippingOptions: array_values($options),
            itemCount: $itemCount,
            subtotalCents: $subtotal,
            discountCents: $discount,
            shippingCents: $shipping,
            taxCents: $tax,
            totalCents: $afterDiscount + $shipping + $tax,
        );
    }

    /**
     * [coupon|null, discount cents, error|null]. Percent: rounded to the cent.
     * Fixed: never more than the subtotal. Same messages as the storefront.
     */
    public function coupon(?string $code, int $subtotalCents): array
    {
        $code = strtoupper(trim((string) $code));
        if ($code === '') {
            return [null, 0, null];
        }

        $rule = config("buynest.store.coupons.{$code}");
        if (! $rule) {
            return [null, 0, 'This code is not valid.'];
        }
        if (isset($rule['min_subtotal_cents']) && $subtotalCents < $rule['min_subtotal_cents']) {
            $minimum = rtrim(rtrim(self::format($rule['min_subtotal_cents']), '0'), '.');

            return [null, 0, "Spend at least \${$minimum} to use this code."];
        }

        $discount = $rule['type'] === 'percent'
            ? self::jsRound($subtotalCents * $rule['value'] / 100)
            : $rule['value_cents'];

        return [['code' => $code, 'description' => $rule['description']], min($discount, $subtotalCents), null];
    }

    /** Products by id, including deleted ones (so the cart can say "no longer available"). */
    private function loadProducts(array $ids, bool $lock): Collection
    {
        if ($ids === []) {
            return collect();
        }
        sort($ids); // always lock rows in the same order, so two checkouts can't deadlock
        $query = Product::withTrashed()->with(['category', 'brand'])->whereIn('id', $ids)->orderBy('id');

        return ($lock ? $query->lockForUpdate() : $query)->get()->keyBy('id');
    }

    private function line(int $productId, ?Product $product, int $quantity): array
    {
        $available = $product && ! $product->trashed() && $product->status === 'active';
        $saleCents = $product?->salePriceCents();

        return [
            'product_id' => $productId,
            'product' => $product,
            'name' => $product?->name,
            'sku' => $product?->sku,
            'thumbnail_url' => $product?->thumbnail_url,
            'price_cents' => $available ? $product->priceCents() : null,
            'discount_percent' => $available ? (float) $product->discount_percent : null,
            'sale_cents' => $available ? $saleCents : null,
            'quantity' => $quantity,
            'line_cents' => $available ? $saleCents * $quantity : 0,
            'stock_quantity' => $available ? $product->stock_quantity : 0,
            'min_order_quantity' => $product?->min_order_quantity ?? 1,
            'available' => $available,
        ];
    }

    private function problemWith(?Product $product, int $quantity): ?array
    {
        if (! $product || $product->trashed() || $product->status !== 'active') {
            return ['code' => 'unavailable', 'message' => 'This product is no longer available.'];
        }
        if ($quantity > $product->stock_quantity) {
            return ['code' => 'insufficient_stock', 'message' => $product->stock_quantity === 0
                ? "{$product->name} is out of stock."
                : "Only {$product->stock_quantity} of {$product->name} left in stock."];
        }
        if ($quantity < $product->min_order_quantity) {
            return ['code' => 'below_minimum', 'message' => "The minimum order for {$product->name} is {$product->min_order_quantity}."];
        }

        return null;
    }
}
