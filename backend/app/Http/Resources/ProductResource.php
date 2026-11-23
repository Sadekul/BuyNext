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
            'thumbnail_url' => $this->thumbnail_url,
            // Phase 9 (part B): resized copies for srcset ({} when there are none).
            'thumbnail_variants' => ImageVariants::forApi($this->thumbnail_variants),
            'images' => $this->when($this->detail && $this->relationLoaded('images'), fn () => $this->images
                ->map(fn ($image) => ['url' => $image->url, 'alt' => $image->alt, 'variants' => ImageVariants::forApi($image->variants)])->values()),
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
                    'values' => $option->values->map(fn ($value) => ['id' => $value->id, 'value' => $value->translatedValue($locale)])->values(),
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
        ];
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
