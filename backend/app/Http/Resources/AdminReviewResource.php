<?php

namespace App\Http\Resources;

use App\Http\Controllers\Api\Admin\ReviewController;
use App\Models\Review;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A review as staff see it (see ReviewController::item()).
 *
 * @mixin Review
 */
class AdminReviewResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return ReviewController::item($this->resource);
    }
}
