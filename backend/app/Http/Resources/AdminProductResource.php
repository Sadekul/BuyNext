<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;

/** A product as shop staff see it: the storefront fields plus status and dates. */
class AdminProductResource extends ProductResource
{
    public function toArray(Request $request): array
    {
        return [
            ...parent::toArray($request),
            // Staff edit the description, so even lists include it.
            'description' => $this->description,
            'status' => $this->status,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
