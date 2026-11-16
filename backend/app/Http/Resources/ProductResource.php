<?php

namespace App\Http\Resources;

use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Review;
use App\Services\Pricing;
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
 * @mixin Product
 */
class ProductResource extends JsonResource
{
    protected bool $detail = false;

    public function withDetail(): static
    {
        $this->detail = true;

        return $this;
    }

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'slug' => $this->slug,
            'sku' => $this->sku,
            'description' => $this->when($this->detail, $this->description),
            'brand' => $this->brand ? ['name' => $this->brand->name] : null,
            'category' => ['slug' => $this->category->slug, 'name' => $this->category->name],
            'price' => $this->price,
            'discount_percent' => (float) $this->discount_percent,
            'sale_price' => Pricing::format($this->salePriceCents()),
            'rating_average' => $this->rating_average,
            'review_count' => $this->review_count,
            'stock_quantity' => $this->stock_quantity,
            'availability' => $this->availability(),
            'min_order_quantity' => $this->min_order_quantity,
            'has_variants' => $this->has_variants,
            'thumbnail_url' => $this->thumbnail_url,
            'images' => $this->when($this->detail && $this->relationLoaded('images'), fn () => $this->images
                ->map(fn ($image) => ['url' => $image->url, 'alt' => $image->alt])->values()),
            'tags' => $this->tags ?? [],
            'warranty' => $this->warranty,
            'shipping_info' => $this->shipping_info,
            'return_policy' => $this->return_policy,
            'weight' => $this->weight,
            'reviews' => $this->when($this->detail && $this->relationLoaded('reviews'), fn () => $this->reviews
                ->filter(fn (Review $review) => $review->status === 'approved')
                ->map(fn (Review $review) => self::publicReview($review))->values()),
            'options' => $this->when($this->detail && $this->relationLoaded('options'), fn () => $this->has_variants ? $this->options
                ->map(fn ($option) => [
                    'id' => $option->id,
                    'name' => $option->name,
                    'values' => $option->values->map(fn ($value) => ['id' => $value->id, 'value' => $value->value])->values(),
                ])->values() : []),
            'variants' => $this->when($this->detail && $this->relationLoaded('variants'), fn () => $this->has_variants ? $this->variants
                ->filter(fn (ProductVariant $variant) => $variant->is_active)
                ->map(fn (ProductVariant $variant) => [
                    'id' => $variant->id,
                    'sku' => $variant->sku,
                    'option_value_ids' => $variant->option_value_ids,
                    'price' => $variant->unitPrice($this->resource),
                    'final_price' => Pricing::format($variant->salePriceCents($this->resource)),
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
