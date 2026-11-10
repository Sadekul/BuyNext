<?php

namespace App\Models;

use App\Services\Pricing;
use App\Services\Settings;
use Database\Factories\ProductFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A product. Only `active` products are visible in the store; drafts and
 * archived products are admin-only. Deleting is a soft delete (deleted_at),
 * so past orders keep pointing at it.
 */
#[Fillable([
    'sku', 'name', 'slug', 'description', 'category_id', 'brand_id', 'price', 'discount_percent',
    'stock_quantity', 'min_order_quantity', 'status', 'rating_average', 'thumbnail_url',
    'warranty', 'shipping_info', 'return_policy', 'weight', 'tags',
])]
class Product extends Model
{
    /** @use HasFactory<ProductFactory> */
    use HasFactory, SoftDeletes;

    public const STATUSES = ['draft', 'active', 'archived'];

    /**
     * The sale price in SQL, for filtering and sorting by the price shoppers
     * pay. Same rule as Pricing::salePriceCents() (discounts under 0.5% ignored).
     */
    public const SALE_PRICE_SQL = 'CASE WHEN ROUND(discount_percent) >= 1 THEN ROUND(price * (1 - discount_percent / 100), 2) ELSE price END';

    protected function casts(): array
    {
        return [
            // decimal:2 keeps money as a string ("9.99"), never a float.
            'price' => 'decimal:2',
            'discount_percent' => 'decimal:2',
            'rating_average' => 'decimal:2',
            'stock_quantity' => 'integer',
            'min_order_quantity' => 'integer',
            'weight' => 'integer',
            'tags' => 'array',
        ];
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    public function images(): HasMany
    {
        return $this->hasMany(ProductImage::class)->orderBy('position')->orderBy('id');
    }

    public function reviews(): HasMany
    {
        return $this->hasMany(Review::class)->orderBy('created_at')->orderBy('id');
    }

    /** Product::active(): what shoppers may see and buy. */
    public function scopeActive(Builder $query): void
    {
        $query->where('status', 'active');
    }

    /** in_stock, low_stock (fewer than the threshold), or out_of_stock. */
    public function availability(): string
    {
        return match (true) {
            $this->stock_quantity <= 0 => 'out_of_stock',
            $this->stock_quantity < app(Settings::class)->get('low_stock_threshold') => 'low_stock',
            default => 'in_stock',
        };
    }

    public function priceCents(): int
    {
        return Pricing::toCents($this->price);
    }

    public function salePriceCents(): int
    {
        return Pricing::salePriceCents($this->price, $this->discount_percent);
    }
}
