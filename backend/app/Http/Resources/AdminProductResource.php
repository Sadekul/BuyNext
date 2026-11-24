<?php

namespace App\Http\Resources;

use App\Models\ProductVariant;
use App\Services\Pricing;
use App\Services\ProductLinks;
use App\Services\StockAlerts;
use App\Support\ImageVariants;
use Illuminate\Http\Request;

/**
 * A product as shop staff see it: the storefront fields plus status and dates.
 * Phase 5: the category has its id; the detail's images have ids and
 * positions (for alt text, reorder, delete), and options and variants are the
 * full admin view (inactive variants included).
 */
class AdminProductResource extends ProductResource
{
    public function toArray(Request $request): array
    {
        $base = parent::toArray($request);
        $base['category'] = ['id' => $this->category->id, 'slug' => $this->category->slug, 'name' => $this->category->name];

        if ($this->detail) {
            // Phase 9 (part B): people waiting for "back in stock" emails.
            $base['stock_alerts_waiting'] = app(StockAlerts::class)->waitingCount($this->id);
            // Phase 11: { related, upsell, crosssell: [{ id, name, sku, image, status }] }.
            $base['links'] = app(ProductLinks::class)->forAdmin($this->resource);
            $base['images'] = $this->when($this->relationLoaded('images'), fn () => $this->images->map(fn ($image) => self::image($image))->values());
            $base['options'] = $this->when($this->relationLoaded('options'), fn () => $this->options->map(fn ($option) => [
                'id' => $option->id,
                'name' => $option->name,
                'name_bn' => $option->translationsForAdmin()['bn']['name'], // phase 13: null = English is shown
                'code' => $option->code(), // phase 16: slug of the English name (computed)
                'type' => $option->typeName(), // phase 16: text | color
                'position' => $option->position,
                'values' => $option->values->map(fn ($value) => ['id' => $value->id, 'value' => $value->value,
                    'value_bn' => $value->translationsForAdmin()['bn']['value'], 'code' => $value->code(), 'swatch' => $value->swatch, 'position' => $value->position])->values(),
            ])->values());
            $base['variants'] = $this->when($this->relationLoaded('variants'), function () {
                $map = $this->resource->optionValueMap();
                $optionCount = $this->options->count();

                return $this->variants->map(fn (ProductVariant $variant) => [
                    'id' => $variant->id,
                    'sku' => $variant->sku,
                    'option_value_ids' => $variant->option_value_ids,
                    'label' => $variant->label($map),
                    'price' => $variant->price,
                    'effective_price' => $variant->unitPrice($this->resource),
                    'final_price' => Pricing::format($variant->salePriceCents($this->resource)),
                    'stock_quantity' => $variant->stock_quantity,
                    'weight' => $variant->weight, // phase 10 (part B): grams, null = the product's
                    'is_active' => $variant->is_active,
                    // false: one of its values was removed from the options; it stays inactive.
                    'is_current' => count($variant->option_value_ids ?? []) === $optionCount
                        && array_diff($variant->option_value_ids ?? [], array_keys($map)) === [],
                    'created_at' => $variant->created_at?->toIso8601ZuluString(),
                    'updated_at' => $variant->updated_at?->toIso8601ZuluString(),
                ])->values();
            });
        }

        return [
            ...$base,
            // Staff edit the description, so even lists include it.
            'description' => $this->description,
            // Phase 7: SEO fields (null = the storefront uses the name and description).
            'meta_title' => $this->meta_title,
            'meta_description' => $this->meta_description,
            // Phase 13: the Bangla text (null = the store shows English), rows with label_bn/value_bn, and completeness.
            'specifications' => $this->resource->specificationRowsForAdmin(),
            'translations' => ['bn' => $this->resource->translationFields('bn')],
            'bangla' => $this->resource->banglaStatus(),
            'bangla_complete' => $this->resource->banglaStatus()['complete'],
            'status' => $this->status,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }

    /**
     * An image item: { id, url, alt, position, is_upload, variants, option_value_id }
     * (phase 9 part B: variants = resized copies, {} if none; phase 16: option_value_id = the choice it is shown for, null = all).
     */
    public static function image($image): array
    {
        return [
            'id' => $image->id,
            'url' => $image->url,
            'alt' => $image->alt,
            'position' => $image->position,
            'is_upload' => $image->path !== null,
            'variants' => ImageVariants::forApi($image->variants),
            'option_value_id' => $image->option_value_id,
        ];
    }
}
