<?php

namespace App\Http\Resources;

use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Review;
use App\Services\CatalogRules;
use App\Services\Pricing;
use App\Services\ProductLinks;
use App\Support\ImageVariants;
use App\Support\Locale;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A product as the storefront sees it. Money is a "0.00" string;
 * discount_percent is a number. Lists leave out description, images,
 * reviews, options, and variants (smaller pages); the product page sends them
 * (withDetail()).
 *
 * Phase 5: has_variants and review_count (approved reviews) everywhere; the
 * detail adds options and the active variants ([] for simple products), and
 * reviews are the approved ones only.
 *
 * Phase 7: sale_price and the variants' final_price include catalog price
 * rules for everyone (price_rule: { id, name } | null); discount_percent stays
 * the product's own.
 *
 * @mixin Product
 */
class ProductResource extends JsonResource
{
    protected bool $detail = false;

    /** Phase 11: the storefront product page adds related products and up-sells. */
    protected bool $recommendations = false;

    public function withDetail(): static
    {
        $this->detail = true;

        return $this;
    }

    public function withRecommendations(): static
    {
        $this->recommendations = true;

        return $this;
    }

    public function toArray(Request $request): array
    {
        // Phase 7: a catalog price rule for everyone shows as the sale price when it is lower.
        $rules = app(CatalogRules::class);
        [$saleCents, $rule] = $rules->publicPrice($this->resource);

        // Phase 13: texts in the request language, each field falling back to English; `locale` = the name's language.
        $product = $this->resource;
        $locale = Locale::current();

        return [
            'id' => $this->id,
            'name' => $product->translated('name', $locale),
            'locale' => $product->translatedLocale('name', $locale),
            'slug' => $this->slug,
            'sku' => $this->sku,
            'description' => $this->when($this->detail, fn () => $product->translated('description', $locale)),
            'short_description' => $this->when($this->detail, fn () => $product->translationFor($locale)?->short_description ?: null),
            // Phase 7 (part B, SEO): null = the storefront falls back to the name and description.
            'meta_title' => $this->when($this->detail, fn () => $product->translated('meta_title', $locale)),
            'meta_description' => $this->when($this->detail, fn () => $product->translated('meta_description', $locale)),
            'brand' => $this->brand ? ['name' => $this->brand->name] : null,
            'category' => ['slug' => $this->category->slug, 'name' => $this->category->translated('name', $locale)],
            'price' => $this->price,
            'discount_percent' => (float) $this->discount_percent,
            'sale_price' => Pricing::format($saleCents),
            'price_rule' => $rule,
            'rating_average' => $this->rating_average,
            'review_count' => $this->review_count,
            'stock_quantity' => $this->stock_quantity,
            'availability' => $this->availability(),
            'min_order_quantity' => $this->min_order_quantity,
            'has_variants' => $this->has_variants,
            // Phase 16: { min, max } final prices of the active variants (null for simple products), and the
            // colour option's active values for card dots ([{ value_id, value, swatch, image_url }], at most 12).
            'price_range' => $this->priceRange($rules),
            'swatches' => $this->swatches($locale),
            'thumbnail_url' => $this->thumbnail_url,
            // Phase 9 (part B): resized copies for srcset ({} when there are none).
            'thumbnail_variants' => ImageVariants::forApi($this->thumbnail_variants),
            'images' => $this->when($this->detail && $this->relationLoaded('images'), fn () => $this->images
                ->map(fn ($image) => ['url' => $image->url, 'alt' => $image->alt, 'variants' => ImageVariants::forApi($image->variants),
                    'option_value_id' => $image->option_value_id])->values()), // phase 16: null = shown for every choice
            'tags' => $this->tags ?? [],
            'warranty' => $this->warranty,
            'shipping_info' => $this->shipping_info,
            'return_policy' => $this->return_policy,
            'weight' => $this->weight,
            // Phase 10 (part B): "simple" or "gift_card"; a gift card's amounts ({ amounts, custom: { min, max } | null }, else null).
            'type' => $this->type ?? 'simple',
            'gift_card' => $this->resource->giftCardOptions(),
            // Phase 11: [{ label, value }] ([] when none).
            'specifications' => $this->resource->specificationList($locale),
            'related' => $this->when($this->recommendations, fn () => app(ProductLinks::class)->related($this->resource, $request)),
            'upsells' => $this->when($this->recommendations, fn () => app(ProductLinks::class)->upsells($this->resource, $request)),
            'reviews' => $this->when($this->detail && $this->relationLoaded('reviews'), fn () => $this->reviews
                ->filter(fn (Review $review) => $review->status === 'approved')
                ->map(fn (Review $review) => self::publicReview($review))->values()),
            'options' => $this->when($this->detail && $this->relationLoaded('options'), fn () => $this->has_variants ? $this->options
                ->map(fn ($option) => [
                    'id' => $option->id,
                    'name' => $option->translatedName($locale),
                    'code' => $option->code(), // phase 16: slug of the English name, the same in every language (URL parameters)
                    'type' => $option->typeName(), // phase 16: text | color
                    'values' => $option->values->map(fn ($value) => ['id' => $value->id, 'value' => $value->translatedValue($locale),
                        'code' => $value->code(), 'swatch' => $value->swatch])->values(),
                ])->values() : []),
            'variants' => $this->when($this->detail && $this->relationLoaded('variants'), fn () => $this->has_variants ? $this->variants
                ->filter(fn (ProductVariant $variant) => $variant->is_active)
                ->map(fn (ProductVariant $variant) => [
                    'id' => $variant->id,
                    'sku' => $variant->sku,
                    'option_value_ids' => $variant->option_value_ids,
                    'price' => $variant->unitPrice($this->resource),
                    'final_price' => Pricing::format($rules->publicPrice($this->resource, $variant)[0]),
                    'stock_quantity' => $variant->stock_quantity,
                    'in_stock' => $variant->stock_quantity > 0,
                ])->values() : []),
            // Phase 17: units sold in the last 90 days (orders not cancelled), only on ?sort=best_selling lists
            // (the column comes from Product::orderByBestSelling()'s joined subquery; absent everywhere else).
            'units_sold' => $this->when(array_key_exists('units_sold', $this->resource->getAttributes()),
                fn () => (int) $this->resource->getAttributes()['units_sold']),
        ];
    }

    /** Phase 16: list cards show at most this many swatches' data (the card itself draws 5 and "+n"). */
    public const MAX_SWATCHES = 12;

    /** The active variants of a configurable product (none for a simple one). Uses Product::CARD_RELATIONS when loaded. */
    private function activeVariants()
    {
        if (! $this->has_variants) {
            return collect();
        }
        $this->resource->loadMissing('variants');

        return $this->variants->filter(fn (ProductVariant $variant) => $variant->is_active)->values();
    }

    /** Phase 16: { min, max } of the active variants' final prices (rules for everyone included); null for simple products. */
    private function priceRange(CatalogRules $rules): ?array
    {
        $cents = $this->activeVariants()->map(fn (ProductVariant $variant) => $rules->publicPrice($this->resource, $variant)[0]);
        if ($cents->isEmpty()) {
            return null;
        }

        return ['min' => Pricing::format($cents->min()), 'max' => Pricing::format($cents->max())];
    }

    /**
     * Phase 16: the colour option's values used by an active variant, in option order:
     * [{ value_id, value (request language), swatch (#RRGGBB|null), image_url (its first own image|null) }].
     */
    private function swatches(string $locale): array
    {
        $variants = $this->activeVariants();
        if ($variants->isEmpty()) {
            return [];
        }
        $this->resource->loadMissing('options.values');
        $color = $this->options->first(fn ($option) => $option->typeName() === 'color');
        if (! $color) {
            return [];
        }
        $used = array_flip($variants->flatMap(fn (ProductVariant $variant) => $variant->option_value_ids ?? [])->map(fn ($id) => (int) $id)->all());
        // The product page has every image loaded; cards load only the images that belong to a choice.
        $images = $this->relationLoaded('images') ? $this->images : ($this->resource->loadMissing('optionImages')->optionImages);
        $firstImage = [];
        foreach ($images as $image) {
            if ($image->option_value_id !== null) {
                $firstImage[$image->option_value_id] ??= $image->url;
            }
        }

        return $color->values->filter(fn ($value) => isset($used[$value->id]))->take(self::MAX_SWATCHES)
            ->map(fn ($value) => [
                'value_id' => $value->id,
                'value' => $value->translatedValue($locale),
                'swatch' => $value->swatch,
                'image_url' => $firstImage[$value->id] ?? null,
            ])->values()->all();
    }

    /** A review as shoppers see it. */
    public static function publicReview(Review $review): array
    {
        return [
            'id' => $review->id,
            'rating' => $review->rating,
            'title' => $review->title,
            'comment' => $review->comment,
            'created_at' => $review->created_at?->toIso8601ZuluString(),
            'author_name' => $review->author_name,
            'verified_purchase' => $review->verified_purchase,
        ];
    }
}
