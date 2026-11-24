<?php

namespace App\Models;

use App\Models\Concerns\HasTranslations;
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
    'type', 'gift_card_amounts', 'gift_card_min_amount', 'gift_card_max_amount', // phase 10 (part B)
    'specifications', // phase 11
])]
class Product extends Model
{
    use HasTranslations;

    /** Phase 13: the fields with a Bangla version (product_translations etc.). */
    public const TRANSLATABLE = ['name', 'short_description', 'description', 'meta_title', 'meta_description'];

    protected static function translationModel(): string
    {
        return ProductTranslation::class;
    }

    /** @use HasFactory<ProductFactory> */
    use HasFactory, SoftDeletes;

    public const STATUSES = ['draft', 'active', 'archived'];

    /** Phase 10 (part B): a gift card product sells cards of a chosen amount (no stock, shipping, tax, or discounts). */
    public const TYPES = ['simple', 'gift_card'];

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
            // Phase 9 (part B): the thumbnail's resized copies ({ "320": url, "960": url }).
            'thumbnail_variants' => 'array',
            // Phase 10 (part B): gift card products.
            'gift_card_amounts' => 'array',
            'gift_card_min_amount' => 'decimal:2',
            'gift_card_max_amount' => 'decimal:2',
            // Phase 11: [{ label, value }] in order (null = none).
            'specifications' => 'array',
        ];
    }

    /**
     * Phase 9 (part B): thumbnail_variants follows thumbnail_url. When the
     * thumbnail changes (the product form, imports), it takes the copies of
     * this product's image with that address, or none.
     */
    protected static function booted(): void
    {
        static::saving(function (Product $product) {
            if ($product->isDirty('thumbnail_url') && ! $product->isDirty('thumbnail_variants')) {
                $variants = $product->exists && $product->thumbnail_url
                    ? ProductImage::where('product_id', $product->id)->where('url', $product->thumbnail_url)->whereNotNull('variants')->value('variants')
                    : null;
                $product->thumbnail_variants = is_string($variants) ? json_decode($variants, true) : $variants;
            }
        });
        // Phase 11: a deleted product (a soft delete) leaves every wishlist and every product link (both directions).
        static::deleted(function (Product $product) {
            WishlistItem::where('product_id', $product->id)->delete();
            ProductLink::where('product_id', $product->id)->orWhere('linked_product_id', $product->id)->delete();
        });
    }

    /** Phase 11: the product's links of every type, in position order. */
    public function links(): HasMany
    {
        return $this->hasMany(ProductLink::class)->orderBy('type')->orderBy('position')->orderBy('id');
    }

    /**
     * Phase 11: [{ label, value }] (never null).
     * Phase 13: $locale "bn" uses each row's label_bn / value_bn when filled (per field, else the English text).
     */
    public function specificationList(?string $locale = null): array
    {
        $pick = function (array $row, string $field) use ($locale) {
            $translated = $locale && $locale !== 'en' ? ($row["{$field}_{$locale}"] ?? null) : null;

            return is_string($translated) && trim($translated) !== '' ? $translated : (string) ($row[$field] ?? '');
        };

        return array_values(array_map(fn ($row) => ['label' => $pick($row, 'label'), 'value' => $pick($row, 'value')],
            is_array($this->specifications) ? $this->specifications : []));
    }

    /**
     * Phase 13: { complete, missing } in Bangla. Complete = the name is translated, and the
     * description too when the product has an English one (SEO fields and short description are optional).
     */
    public function banglaStatus(): array
    {
        $missing = $this->missingTranslations('bn');
        $required = filled(strip_tags((string) $this->description)) ? ['name', 'description'] : ['name'];

        return ['complete' => array_intersect($required, $missing) === [], 'missing' => array_values($missing)];
    }

    /** Phase 13: products whose Bangla text is complete ($complete) or missing (see banglaStatus()). */
    public function scopeBanglaComplete($query, bool $complete = true)
    {
        $filled = fn (string $column) => "{$column} IS NOT NULL AND TRIM({$column}) <> ''";
        $sql = 'EXISTS (SELECT 1 FROM product_translations pt WHERE pt.product_id = products.id AND pt.locale = \'bn\''
            .' AND '.$filled('pt.name')
            .' AND (products.description IS NULL OR TRIM(products.description) = \'\' OR ('.$filled('pt.description').')))';

        return $complete ? $query->whereRaw($sql) : $query->whereRaw("NOT {$sql}");
    }

    /** Phase 13: the admin's rows: [{ label, value, label_bn, value_bn }] (null = falls back to English). */
    public function specificationRowsForAdmin(): array
    {
        return array_values(array_map(fn ($row) => [
            'label' => (string) ($row['label'] ?? ''), 'value' => (string) ($row['value'] ?? ''),
            'label_bn' => filled($row['label_bn'] ?? null) ? (string) $row['label_bn'] : null,
            'value_bn' => filled($row['value_bn'] ?? null) ? (string) $row['value_bn'] : null,
        ], is_array($this->specifications) ? $this->specifications : []));
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

    /** Phase 16: the images that belong to one choice (for the swatches of product cards). */
    public function optionImages(): HasMany
    {
        return $this->images()->whereNotNull('option_value_id');
    }

    /**
     * Phase 16: what a product card needs for configurable products (price_range, swatches).
     * Add to every list query's with() so cards don't load them one product at a time.
     */
    public const CARD_RELATIONS = ['options.values', 'variants', 'optionImages'];

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
    public function optionValueMap(?string $locale = null): array // phase 13: $locale = names in that language (fallback English)
    {
        $this->loadMissing('options.values');
        $map = [];
        foreach ($this->options as $option) {
            foreach ($option->values as $value) {
                $map[$value->id] = $locale === null
                    ? [$option->name, $value->value, $option->position]
                    : [$option->translatedName($locale), $value->translatedValue($locale), $option->position];
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
        // Phase 9 (part B): the resized copies follow too (they may be made after the image).
        if ($first && ($this->thumbnail_url !== $first->url || $this->thumbnail_variants !== $first->variants)) {
            $this->forceFill(['thumbnail_url' => $first->url, 'thumbnail_variants' => $first->variants])->save();
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
            $this->isGiftCard() => 'in_stock', // phase 10 (part B): gift cards have no stock
            $this->stock_quantity <= 0 => 'out_of_stock',
            $this->stock_quantity < app(Settings::class)->get('low_stock_threshold') => 'low_stock',
            default => 'in_stock',
        };
    }

    /** Phase 10 (part B). */
    public function isGiftCard(): bool
    {
        return $this->type === 'gift_card';
    }

    /**
     * Phase 10 (part B): what a gift card product offers, for the answers:
     * { amounts: ["25.00", ...], custom: { min, max } | null }, or null for other products.
     */
    public function giftCardOptions(): ?array
    {
        if (! $this->isGiftCard()) {
            return null;
        }
        $amounts = array_map(fn ($amount) => Pricing::format(Pricing::toCents((string) $amount)), $this->gift_card_amounts ?? []);
        sort($amounts, SORT_NUMERIC);

        return [
            'amounts' => array_values($amounts),
            'custom' => $this->gift_card_min_amount !== null && $this->gift_card_max_amount !== null
                ? ['min' => $this->gift_card_min_amount, 'max' => $this->gift_card_max_amount] : null,
        ];
    }

    /** Phase 10 (part B): is $cents an amount this gift card product sells? */
    public function allowsGiftCardAmount(int $cents): bool
    {
        if ($cents <= 0) {
            return false;
        }
        foreach ($this->gift_card_amounts ?? [] as $amount) {
            if (Pricing::toCents((string) $amount) === $cents) {
                return true;
            }
        }

        return $this->gift_card_min_amount !== null && $this->gift_card_max_amount !== null
            && $cents >= Pricing::toCents($this->gift_card_min_amount) && $cents <= Pricing::toCents($this->gift_card_max_amount);
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
