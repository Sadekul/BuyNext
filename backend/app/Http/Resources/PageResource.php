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

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->unless($this->storefront, $this->id),
            'slug' => $this->slug,
            'url' => "/pages/{$this->slug}",
            'title' => $this->title,
            'body' => $this->body,
            'meta_title' => $this->meta_title,
            'meta_description' => $this->meta_description,
            'is_published' => $this->unless($this->storefront, $this->is_published),
            'created_at' => $this->unless($this->storefront, fn () => $this->created_at?->toIso8601ZuluString()),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
