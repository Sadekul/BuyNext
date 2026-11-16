<?php

namespace App\Services;

use App\Models\Coupon;
use App\Models\CustomerGroup;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Support\CategoryTree;
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
    public function __construct(private Settings $settings) {}

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
     * Prices a cart. $items: [['product_id' => 1, 'variant_id' => null, 'quantity' => 2], ...].
     * With $lock (inside a DB transaction) the product rows are locked until
     * the transaction ends, so two checkouts can't sell the same last unit.
     */
    /**
     * $customerId / $email identify the shopper for per-customer coupon
     * limits (the customer's id when signed in, else the guest's email; both
     * null skips that check until checkout, where the email is required).
     * $country: the shipping country, for tax (null: tax 0, not estimated).
     * $group (phase 6): the shopper's customer group; null = General (guests).
     * Its discount comes off every line's sale price, after the product's own
     * discount and before coupons.
     */
    public function quote(array $items, ?string $couponCode, string $shippingMethod, bool $lock = false, ?int $customerId = null,
        ?string $email = null, ?string $country = null, ?CustomerGroup $group = null): CartQuote
    {
        $group ??= CustomerGroup::general();
        $groupBasisPoints = $group?->discountBasisPoints() ?? 0;
        // The same product (and variant) twice counts as one line (stock is checked on the sum).
        // The same product with two different variants is two lines.
        $quantities = [];
        foreach ($items as $item) {
            $key = (int) $item['product_id'].':'.(int) ($item['variant_id'] ?? 0);
            $quantities[$key] = ($quantities[$key] ?? 0) + (int) $item['quantity'];
        }

        $productIds = array_values(array_unique(array_map(fn ($key) => (int) explode(':', $key)[0], array_keys($quantities))));
        $variantIds = array_values(array_filter(array_unique(array_map(fn ($key) => (int) explode(':', $key)[1], array_keys($quantities)))));
        // Products first, then variants, each in id order: the same order everywhere, so checkouts can't deadlock.
        $products = $this->loadProducts($productIds, $lock);
        $variants = $this->loadVariants($variantIds, $lock);
        $tree = CategoryTree::load();

        $lines = [];
        $problems = [];
        foreach ($quantities as $key => $quantity) {
            [$productId, $variantId] = array_map('intval', explode(':', $key));
            $product = $products->get($productId);
            $variant = $variantId ? $variants->get($variantId) : null;
            $problem = $this->problemWith($product, $variantId ?: null, $variant, $quantity, $tree);
            $lines[] = $this->line($productId, $variantId ?: null, $product, $variant, $quantity, $problem['code'] ?? null, $groupBasisPoints);
            if ($problem) {
                $problems[] = ['product_id' => $productId, 'variant_id' => $variantId ?: null, ...$problem];
            }
        }

        // Unavailable lines are shown but never charged.
        $charged = array_filter($lines, fn ($line) => $line['available']);
        $itemCount = array_sum(array_column($charged, 'quantity'));
        $subtotal = array_sum(array_column($charged, 'line_cents'));
        $groupDiscount = array_sum(array_map(fn ($line) => ($line['base_sale_cents'] - $line['sale_cents']) * $line['quantity'], $charged));

        [$coupon, $discount, $couponError, $couponRecord] = $this->coupon($couponCode, $subtotal, $customerId, $email, $lock);
        $afterDiscount = $subtotal - $discount;
        $freeStandard = $afterDiscount >= $this->settings->cents('free_shipping_threshold');
        // A free_shipping coupon makes every method free (not just standard).
        $freeEverything = $couponRecord?->type === 'free_shipping';

        // Only the methods switched on in the settings (with their prices from there).
        $options = [];
        foreach ($this->settings->shippingMethods() as $id => $method) {
            $options[$id] = [
                'id' => $id,
                'label' => $method['label'],
                'eta' => $method['eta'],
                'price_cents' => $freeEverything || ($method['free_over_threshold'] && $freeStandard) ? 0 : $method['price_cents'],
            ];
        }
        $method = $options[$shippingMethod] ?? $options[$this->settings->defaultShippingMethod()] ?? reset($options);
        $shipping = $itemCount > 0 ? $method['price_cents'] : 0;
        [$tax, $taxIncluded] = $itemCount > 0 ? $this->tax($afterDiscount + $shipping, $country) : [0, false];

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
            // Prices that already include tax: the tax is shown, but not added again.
            totalCents: $afterDiscount + $shipping + ($taxIncluded ? 0 : $tax),
            couponId: $couponRecord?->id,
            taxEstimated: ! $this->settings->get('tax_enabled') || $country !== null,
            group: $group,
            groupDiscountCents: $groupDiscount,
        );
    }

    /**
     * [tax cents, included?]. Tax = the shipping country's rate × (merchandise
     * after the discount + shipping), rounded to the cent (halves up). With
     * prices_include_tax the amount already contains the tax, so the tax is
     * the part of it that is tax: amount × rate / (100 + rate).
     * Rates are kept in hundredths of a percent (19.00% → 1900), so this is
     * all integer math.
     */
    public function tax(int $amountCents, ?string $country): array
    {
        $rate = $this->settings->taxRateBasisPoints($country);
        if (! $rate || $amountCents <= 0) {
            return [0, false];
        }
        $included = (bool) $this->settings->get('prices_include_tax');
        $divisor = $included ? 10000 + $rate : 10000;

        return [intdiv($amountCents * $rate * 2 + $divisor, $divisor * 2), $included];
    }

    /**
     * [coupon|null, discount cents, error|null, Coupon|null]. The rules live in
     * the coupons table (Coupon::problemFor() has the checks and messages).
     * With $lock (checkout) the coupon row stays locked until the order is
     * written, so two checkouts can't both take the last use.
     */
    public function coupon(?string $code, int $subtotalCents, ?int $customerId = null, ?string $email = null, bool $lock = false): array
    {
        $code = Coupon::normalize($code);
        if ($code === '') {
            return [null, 0, null, null];
        }

        $query = Coupon::where('code', $code);
        $record = ($lock ? $query->lockForUpdate() : $query)->first();
        $problem = $record ? $record->problemFor($subtotalCents, $customerId, $email) : 'This code is not valid.';
        if ($problem) {
            return [null, 0, $problem, null];
        }

        return [['code' => $record->code, 'description' => $record->description], $record->discountCents($subtotalCents), null, $record];
    }

    /** Products by id, including deleted ones (so the cart can say "no longer available"). */
    private function loadProducts(array $ids, bool $lock): Collection
    {
        if ($ids === []) {
            return collect();
        }
        sort($ids); // always lock rows in the same order, so two checkouts can't deadlock
        $query = Product::withTrashed()->with(['category', 'brand', 'options.values'])->whereIn('id', $ids)->orderBy('id');

        return ($lock ? $query->lockForUpdate() : $query)->get()->keyBy('id');
    }

    /** Variants by id; with $lock their rows stay locked too (stock is taken from the variant). */
    private function loadVariants(array $ids, bool $lock): Collection
    {
        if ($ids === []) {
            return collect();
        }
        sort($ids);
        $query = ProductVariant::whereIn('id', $ids)->orderBy('id');

        return ($lock ? $query->lockForUpdate() : $query)->get()->keyBy('id');
    }

    /** Problems that make a line unavailable (not charged); stock and minimum problems still price the line. */
    private const UNAVAILABLE = ['unavailable', 'variant_required', 'variant_unavailable'];

    /**
     * A group discount on a sale price, in cents: round(cents × (1 − percent / 100)),
     * halves up. $basisPoints: hundredths of a percent (10.00% → 1000).
     */
    public static function groupPriceCents(int $saleCents, int $basisPoints): int
    {
        if ($basisPoints <= 0) {
            return $saleCents;
        }

        return intdiv($saleCents * (10000 - $basisPoints) * 2 + 10000, 20000);
    }

    private function line(int $productId, ?int $variantId, ?Product $product, ?ProductVariant $variant, int $quantity, ?string $problem,
        int $groupBasisPoints = 0): array
    {
        $available = $product !== null && ! in_array($problem, self::UNAVAILABLE, true);
        $sellsVariant = $available && $variant !== null;
        $priceCents = $available ? ($sellsVariant ? $variant->priceCents($product) : $product->priceCents()) : null;
        $baseSaleCents = $available ? ($sellsVariant ? $variant->salePriceCents($product) : $product->salePriceCents()) : null;
        $saleCents = $available ? self::groupPriceCents($baseSaleCents, $groupBasisPoints) : null;

        return [
            'product_id' => $productId,
            'variant_id' => $variantId,
            'product' => $product,
            'variant' => $sellsVariant ? $variant : null,
            'name' => $product?->name,
            'variant_label' => $sellsVariant ? $variant->label($product->optionValueMap()) : null,
            'sku' => $sellsVariant ? $variant->sku : $product?->sku,
            'thumbnail_url' => $product?->thumbnail_url,
            'price_cents' => $priceCents,
            'discount_percent' => $available ? (float) $product->discount_percent : null,
            'group_discount_percent' => $available ? $groupBasisPoints / 100 : null,
            'base_sale_cents' => $baseSaleCents,
            'sale_cents' => $saleCents,
            'quantity' => $quantity,
            'line_cents' => $available ? $saleCents * $quantity : 0,
            'stock_quantity' => $available ? ($sellsVariant ? $variant->stock_quantity : $product->stock_quantity) : 0,
            'min_order_quantity' => $product?->min_order_quantity ?? 1,
            'available' => $available,
        ];
    }

    private function problemWith(?Product $product, ?int $variantId, ?ProductVariant $variant, int $quantity, CategoryTree $tree): ?array
    {
        if (! $product || ! $product->isForSale($tree)) {
            return ['code' => 'unavailable', 'message' => 'This product is no longer available.'];
        }
        if ($product->has_variants && $variantId === null) {
            return ['code' => 'variant_required', 'message' => "Choose the options for {$product->name}."];
        }
        if ($variantId !== null && (! $product->has_variants || ! $variant || $variant->product_id !== $product->id
            || ! $variant->is_active || ! $this->isCurrentCombination($product, $variant))) {
            return ['code' => 'variant_unavailable', 'message' => "This option of {$product->name} is no longer available."];
        }
        $stock = $variant ? $variant->stock_quantity : $product->stock_quantity;
        $label = $variant ? "{$product->name} ({$variant->label($product->optionValueMap())})" : $product->name;
        if ($quantity > $stock) {
            return ['code' => 'insufficient_stock', 'message' => $stock === 0
                ? "{$label} is out of stock."
                : "Only {$stock} of {$label} left in stock."];
        }
        if ($quantity < $product->min_order_quantity) {
            return ['code' => 'below_minimum', 'message' => "The minimum order for {$product->name} is {$product->min_order_quantity}."];
        }

        return null;
    }

    /** One value of every current option (values removed since make it stale). */
    private function isCurrentCombination(Product $product, ProductVariant $variant): bool
    {
        $map = $product->optionValueMap();
        $ids = $variant->option_value_ids ?? [];

        return count($ids) === $product->options->count() && array_diff($ids, array_keys($map)) === [];
    }
}
