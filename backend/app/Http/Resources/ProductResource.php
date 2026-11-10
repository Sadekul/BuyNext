<?php

namespace App\Http\Resources;

use App\Services\Pricing;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A product as the storefront sees it. Money is a "0.00" string;
 * discount_percent is a number. Lists leave out description, images, and
 * reviews (smaller pages); the product page sends them (withDetail()).
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
            'stock_quantity' => $this->stock_quantity,
            'availability' => $this->availability(),
            'min_order_quantity' => $this->min_order_quantity,
            'thumbnail_url' => $this->thumbnail_url,
            'images' => $this->when($this->detail && $this->relationLoaded('images'), fn () => $this->images
                ->map(fn ($image) => ['url' => $image->url, 'alt' => $image->alt])->values()),
            'tags' => $this->tags ?? [],
            'warranty' => $this->warranty,
            'shipping_info' => $this->shipping_info,
            'return_policy' => $this->return_policy,
            'weight' => $this->weight,
            'reviews' => $this->when($this->detail && $this->relationLoaded('reviews'), fn () => $this->reviews
                ->map(fn ($review) => [
                    'rating' => $review->rating,
                    'comment' => $review->comment,
                    'created_at' => $review->created_at?->toIso8601ZuluString(),
                    'author_name' => $review->author_name,
                ])->values()),
        ];
    }
}
