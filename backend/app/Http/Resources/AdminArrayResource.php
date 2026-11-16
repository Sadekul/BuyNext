<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A model that knows its admin shape (toAdminArray()), for paginated lists in
 * the usual { data, links, meta } form (phase 7: catalog rules, search terms).
 */
class AdminArrayResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return $this->resource->toAdminArray();
    }
}
