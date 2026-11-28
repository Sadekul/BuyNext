<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Review;
use App\Models\ReviewPhoto;
use App\Services\Audit;
use App\Services\Reviews;
use App\Support\CategoryTree;
use App\Support\Locale;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Phase 23: My account → My reviews. A customer sees their own reviews in every status (with every
 * photo, hidden ones too), can delete a photo or the whole review. Somebody else's review or photo is
 * always the same 404 as one that doesn't exist (never 403: that would confirm it exists).
 */
class MyReviewController extends Controller
{
    public function __construct(private Reviews $reviews, private Audit $audit) {}

    /** GET /api/v1/me/reviews?page&per_page (1-50, default 10)&product_id → newest first, { data, links, meta }. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:50'],
            'product_id' => ['nullable', 'integer', 'min:1'],
        ]);

        $page = Review::where('customer_id', $request->user()->id)
            ->when($data['product_id'] ?? null, fn ($q, $id) => $q->where('product_id', $id))
            ->with(['product.translations', 'photos'])
            ->latest('created_at')->latest('id')
            ->paginate($data['per_page'] ?? 10)
            ->withQueryString();

        $tree = CategoryTree::load();

        return JsonResource::collection($page->through(fn (Review $review) => self::item($review, $tree)));
    }

    /**
     * GET /api/v1/me/reviews/{id}/photos/{photo} → the bytes of the author's own photo in every status
     * (hidden ones too), never cached.
     */
    public function photo(Request $request, int $id, int $photo): Response|JsonResponse
    {
        $found = $this->ownPhoto($request, $id, $photo)->first();
        $bytes = $found ? Storage::disk('local')->get($found->path) : null;
        if ($bytes === null) {
            return $this->photoNotFound();
        }

        return ReviewController::photoResponse($found, $bytes, 'private, no-store');
    }

    /**
     * DELETE /api/v1/me/reviews/{id} → 204. The photo files go after the commit, the product's rating
     * and review count follow when it was approved; reward points already earned stay.
     */
    public function destroy(Request $request, int $id): Response|JsonResponse
    {
        $customer = $request->user();
        $deleted = DB::transaction(function () use ($customer, $id) {
            $review = Review::with('product')->where('customer_id', $customer->id)->lockForUpdate()->find($id);
            if (! $review) {
                return false;
            }
            $this->reviews->delete($review, author: $customer);

            return true;
        });

        return $deleted ? response()->noContent() : $this->reviewNotFound();
    }

    /**
     * DELETE /api/v1/me/reviews/{id}/photos/{photo} → { data: review item }. The other photos are
     * renumbered (0, 1, …); the review keeps its status (removing something needs no new approval).
     */
    public function destroyPhoto(Request $request, int $id, int $photo): JsonResponse
    {
        $customer = $request->user();
        $found = DB::transaction(function () use ($request, $customer, $id, $photo) {
            $review = Review::with('product')->where('customer_id', $customer->id)->lockForUpdate()->find($id);
            $found = $review ? $this->ownPhoto($request, $id, $photo)->first() : null;
            if (! $found) {
                return null;
            }
            $found->delete();
            $review->photos()->get()->values()->each(function (ReviewPhoto $rest, int $position) {
                if ($rest->position !== $position) {
                    $rest->update(['position' => $position]);
                }
            });
            $this->audit->record('review.photo_deleted_by_customer', 'Photo '.($found->position + 1)." of review #{$review->id} on product {$review->product?->sku} deleted by its author.",
                'review', $review->id, ['before' => ['photo_id' => $found->id, 'position' => $found->position, 'hidden' => $found->hidden, 'customer_email' => $customer->email], 'after' => []]);
            DB::afterCommit(fn () => ReviewPhoto::deleteFiles([$found]));

            return $found;
        });
        if (! $found) {
            return $this->photoNotFound();
        }

        $review = Review::with(['product.translations', 'photos'])->find($id);

        return response()->json(['data' => self::item($review, CategoryTree::load())]);
    }

    /** A review as its author sees it in My reviews. */
    public static function item(Review $review, CategoryTree $tree): array
    {
        $product = $review->product;
        $locale = Locale::current();

        return [
            'id' => $review->id,
            'status' => $review->status,
            'rating' => $review->rating,
            'title' => $review->title,
            'comment' => $review->comment,
            'created_at' => $review->created_at?->toIso8601ZuluString(),
            'verified_purchase' => (bool) $review->verified_purchase,
            // available: false once the product is deleted or not for sale (the store then shows the name without a link).
            'product' => $product ? [
                'id' => $product->id,
                'name' => $product->translated('name', $locale),
                'thumbnail_url' => $product->thumbnail_url,
                'available' => $product->isForSale($tree),
            ] : null,
            // Every photo, hidden ones too; url = the storefront's owner-only address (the sign-in service serves it).
            'photos' => $review->photos->map(fn (ReviewPhoto $photo) => [
                'id' => $photo->id,
                'url' => "/api/shop/me/reviews/{$review->id}/photos/{$photo->id}",
                'width' => $photo->width,
                'height' => $photo->height,
                'hidden' => $photo->hidden,
                'position' => $photo->position,
            ])->values()->all(),
        ];
    }

    /** The photo, only when it belongs to this customer's review $id. */
    private function ownPhoto(Request $request, int $id, int $photo)
    {
        return ReviewPhoto::where('review_id', $id)->whereKey($photo)
            ->whereHas('review', fn ($q) => $q->where('customer_id', $request->user()->id));
    }

    private function reviewNotFound(): JsonResponse
    {
        return response()->json(['message' => __('Review not found.')], 404);
    }

    private function photoNotFound(): JsonResponse
    {
        return response()->json(['message' => __('Photo not found.')], 404);
    }
}
