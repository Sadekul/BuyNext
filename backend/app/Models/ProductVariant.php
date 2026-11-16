<?php

namespace App\Models;

use App\Services\Pricing;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One sellable combination of a configurable product ("Size: M / Color: Red"):
 * its own SKU, stock, and optionally its own price (null = the product's).
 * The product's discount percent applies to it. Variants are never deleted,
 * so old orders keep their link; ones whose values were removed are deactivated.
 */
#[Fillable(['product_id', 'sku', 'option_value_ids', 'option_key', 'price', 'stock_quantity', 'is_active'])]
class ProductVariant extends Model
{
    public const MAX_PER_PRODUCT = 200;

    protected function casts(): array
    {
        return [
            'option_value_ids' => 'array',
            'price' => 'decimal:2',
            'stock_quantity' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }

    /** The sorted value ids joined with "-": one variant per combination. */
    public static function keyFor(array $valueIds): string
    {
        $ids = array_map('intval', $valueIds);
        sort($ids);

        return implode('-', $ids);
    }

    /** The unit price before the discount: its own, or the product's. */
    public function unitPrice(Product $product): string
    {
        return $this->price ?? $product->price;
    }

    public function priceCents(Product $product): int
    {
        return Pricing::toCents($this->unitPrice($product));
    }

    public function salePriceCents(Product $product): int
    {
        return Pricing::salePriceCents($this->unitPrice($product), $product->discount_percent);
    }

    /**
     * "Size: M / Color: Red", in the product's option order. $values: value id => [option name, value, option position].
     * Values that no longer exist are left out.
     */
    public function label(array $values): string
    {
        $parts = array_filter(array_map(fn ($id) => $values[$id] ?? null, $this->option_value_ids ?? []));
        usort($parts, fn ($a, $b) => $a[2] <=> $b[2]);

        return implode(' / ', array_map(fn ($part) => "{$part[0]}: {$part[1]}", $parts));
    }
}
