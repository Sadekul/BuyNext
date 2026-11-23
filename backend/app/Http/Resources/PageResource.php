<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A content page. The storefront gets what it shows (forStorefront());
 * the admin also gets the id, the published flag, and created_at.
 */
class PageResource extends JsonResource
{
    protected bool $storefront = false;

    public function forStorefront(): static
    {
        $this->storefront = true;

        return $this;
    }

    /** Phase 13: { complete, missing } — complete when every $required field has Bangla text. */
    public static function banglaStatus(array $missing, array $required): array
    {
        return ['complete' => array_intersect($required, $missing) === [], 'missing' => array_values($missing)];
    }

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->unless($this->storefront, $this->id),
            'slug' => $this->slug,
            'url' => "/pages/{$this->slug}",
            // Phase 13: the store gets the request language (per-field fallback to English) and `locale`;
            // the admin gets the base text and translations.bn.
            'title' => $this->storefront ? $this->resource->translated('title') : $this->title,
            'body' => $this->storefront ? $this->resource->translated('body') : $this->body,
            'meta_title' => $this->storefront ? $this->resource->translated('meta_title') : $this->meta_title,
            'meta_description' => $this->storefront ? $this->resource->translated('meta_description') : $this->meta_description,
            'locale' => $this->when($this->storefront, fn () => $this->resource->translatedLocale('title')),
            'translations' => $this->unless($this->storefront, fn () => ['bn' => $this->resource->translationFields('bn')]),
            'bangla' => $this->unless($this->storefront, fn () => self::banglaStatus($this->resource->missingTranslations('bn'), ['title', 'body'])),
            'is_published' => $this->unless($this->storefront, $this->is_published),
            'created_at' => $this->unless($this->storefront, fn () => $this->created_at?->toIso8601ZuluString()),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
