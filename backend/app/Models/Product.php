<?php

namespace App\Models;

use App\Services\Pricing;
use App\Services\Settings;
use App\Support\CategoryTree;
use Database\Factories\ProductFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

/**
 * A product. Only `active` products in a visible category are for sale
 * (forSale()); drafts and archived products are admin-only. Deleting is a
 * soft delete (deleted_at), so past orders keep pointing at it.
 *
 * Phase 5: a product with options (has_variants) sells only through its
 * variants; its stock_quantity is kept equal to the sum of its active
 * variants' stock (syncVariantStock()). review_count and rating_average come
 * from the approved reviews (refreshReviewStats()).
 */
#[Fillable([
    'sku', 'name', 'slug', 'description', 'category_id', 'brand_id', 'price', 'discount_percent',
    'stock_quantity', 'min_order_quantity', 'status', 'rating_average', 'thumbnail_url',
    'warranty', 'shipping_info', 'return_policy', 'weight', 'tags', 'meta_title', 'meta_description',
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
            'has_variants' => 'boolean',
            'review_count' => 'integer',
        ];
    }

    /** The image limit per product (uploads and URLs together). */
    public const MAX_IMAGES = 12;

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

    /** What the product page shows. */
    public function approvedReviews(): HasMany
    {
        return $this->reviews()->where('status', 'approved');
    }

    public function options(): HasMany
    {
        return $this->hasMany(ProductOption::class)->orderBy('position')->orderBy('id');
    }

    public function variants(): HasMany
    {
        return $this->hasMany(ProductVariant::class)->orderBy('id');
    }

    /** Product::active(): status active (the category is not checked; see forSale()). */
    public function scopeActive(Builder $query): void
    {
        $query->where('status', 'active');
    }

    /** Product::forSale(): what shoppers may see and buy: active, in a visible category. */
    public function scopeForSale(Builder $query, ?CategoryTree $tree = null): void
    {
        $query->where('status', 'active')->whereIn('category_id', ($tree ?? CategoryTree::load())->visibleIds());
    }

    public function isForSale(?CategoryTree $tree = null): bool
    {
        return ! $this->trashed() && $this->status === 'active' && ($tree ?? CategoryTree::load())->isVisible($this->category_id);
    }

    /**
     * value id => [option name, value, option position], for variant labels.
     * Loads options.values if needed.
     */
    public function optionValueMap(): array
    {
        $this->loadMissing('options.values');
        $map = [];
        foreach ($this->options as $option) {
            foreach ($option->values as $value) {
                $map[$value->id] = [$option->name, $value->value, $option->position];
            }
        }

        return $map;
    }

    /** A product with variants: its stock is the sum of its active variants' stock. */
    public function syncVariantStock(): void
    {
        if ($this->has_variants) {
            $this->forceFill(['stock_quantity' => (int) $this->variants()->where('is_active', true)->sum('stock_quantity')])->save();
        }
    }

    /** review_count (and rating_average, unless $rating is false) from the approved reviews. */
    public function refreshReviewStats(bool $rating = true): void
    {
        $approved = $this->reviews()->where('status', 'approved');
        $count = (clone $approved)->count();
        $this->forceFill(['review_count' => $count]);
        if ($rating) {
            $this->rating_average = $count ? number_format(round((float) (clone $approved)->avg('rating'), 2), 2, '.', '') : '0.00';
        }
        $this->save();
    }

    /** The thumbnail follows the first image; with no images it stays as it is. */
    public function syncThumbnail(): void
    {
        $first = $this->images()->first();
        if ($first && $this->thumbnail_url !== $first->url) {
            $this->forceFill(['thumbnail_url' => $first->url])->save();
        }
    }

    /** "Blue Mug" → "blue-mug", or "blue-mug-2" if taken (deleted products keep their slugs too). $taken: slugs used by unsaved products. */
    public static function uniqueSlug(string $name, array $taken = []): string
    {
        $base = Str::slug($name) ?: 'product';
        $slug = $base;
        for ($n = 2; in_array($slug, $taken, true) || self::withTrashed()->where('slug', $slug)->exists(); $n++) {
            $slug = "{$base}-{$n}";
        }

        return $slug;
    }

    /** Is $sku used by another product or any variant? */
    public static function skuTaken(string $sku, ?int $exceptProductId = null, ?int $exceptVariantId = null): bool
    {
        return self::withTrashed()->where('sku', $sku)->when($exceptProductId, fn ($q) => $q->whereKeyNot($exceptProductId))->exists()
            || ProductVariant::where('sku', $sku)->when($exceptVariantId, fn ($q) => $q->whereKeyNot($exceptVariantId))->exists();
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
