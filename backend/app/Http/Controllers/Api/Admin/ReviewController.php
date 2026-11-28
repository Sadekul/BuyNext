<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\V1\ReviewController as StoreReviewController;
use App\Http\Controllers\Controller;
use App\Http\Resources\AdminReviewResource;
use App\Models\Review;
use App\Models\ReviewPhoto;
use App\Services\Audit;
use App\Services\Reviews;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Review moderation (Magento's Marketing → Reviews): reviews.view to read,
 * reviews.moderate to approve, reject, or delete. Every change is audited and
 * keeps the product's rating and review count equal to its approved reviews.
 *
 * Phase 22: review photos. Staff see every photo (whatever the status), can
 * hide or show a single photo, and filter reviews with photos (has_photos=1).
 */
class ReviewController extends Controller
{
    public function __construct(private Reviews $reviews, private Audit $audit) {}

    /** GET /api/admin/v1/reviews?status&product_id&rating&search&has_photos&page&per_page - newest first. */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'status' => ['nullable', Rule::in(Review::STATUSES)],
            'product_id' => ['nullable', 'integer', 'min:1'],
            'rating' => ['nullable', 'integer', 'min:1', 'max:5'],
            'search' => ['nullable', 'string', 'max:100'],
            'has_photos' => ['nullable', 'boolean'], // phase 22
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $page = Review::with(['product', 'customer', 'photos'])
            ->when($data['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when($data['product_id'] ?? null, fn ($q, $id) => $q->where('product_id', $id))
            ->when($data['rating'] ?? null, fn ($q, $rating) => $q->where('rating', $rating))
            // Phase 22: reviews with at least one photo, hidden or not.
            ->when(filter_var($data['has_photos'] ?? false, FILTER_VALIDATE_BOOLEAN), fn ($q) => $q->whereHas('photos'))
            ->when($data['search'] ?? null, function ($query, $search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $query->where(fn ($q) => $q->where('comment', 'like', $like)->orWhere('title', 'like', $like)->orWhere('author_name', 'like', $like)
                    ->orWhereHas('product', fn ($p) => $p->withTrashed()->where('name', 'like', $like)->orWhere('sku', 'like', $like)));
            })
            ->latest('created_at')->latest('id')
            ->paginate($data['per_page'] ?? 20)
            ->withQueryString();

        // meta.counts: how many reviews each status has (for the filter tabs), whatever the filters.
        $counts = array_merge(array_fill_keys(Review::STATUSES, 0),
            Review::selectRaw('status, COUNT(*) AS n')->groupBy('status')->pluck('n', 'status')->map(fn ($n) => (int) $n)->all());

        return AdminReviewResource::collection($page)->additional(['meta' => ['counts' => $counts]])->response();
    }

    /** PATCH /api/admin/v1/reviews/{id} { status } */
    public function update(Request $request, int $id): JsonResponse
    {
        $data = $request->validate(['status' => ['required', Rule::in(Review::STATUSES)]], ['status.in' => 'The status must be pending, approved, or rejected.']);
        $review = Review::find($id);
        if (! $review) {
            return $this->notFound();
        }

        DB::transaction(fn () => $this->reviews->setStatus($review, $data['status']));

        return response()->json(['data' => self::item($review->fresh(['product', 'customer', 'photos']))]);
    }

    /**
     * Phase 22: GET /api/admin/v1/reviews/{id}/photos/{photo} (reviews.view) → the photo's bytes in
     * every status (hidden ones too), never cached. 404 when the photo isn't this review's.
     */
    public function photo(int $id, int $photo): Response|JsonResponse
    {
        $found = ReviewPhoto::where('review_id', $id)->whereKey($photo)->first();
        $bytes = $found ? Storage::disk('local')->get($found->path) : null;
        if ($bytes === null) {
            return response()->json(['message' => 'Photo not found.'], 404);
        }

        return StoreReviewController::photoResponse($found, $bytes, 'private, no-store');
    }

    /**
     * Phase 22: PATCH /api/admin/v1/reviews/{id}/photos/{photo} { hidden: bool } (reviews.moderate)
     * → { data: review item }. Audited as review.photo_hidden / review.photo_shown (not when nothing changed).
     */
    public function updatePhoto(Request $request, int $id, int $photo): JsonResponse
    {
        $data = $request->validate(['hidden' => ['required', 'boolean']], [
            'hidden.required' => 'Say whether the photo is hidden (true or false).',
            'hidden.boolean' => 'Say whether the photo is hidden (true or false).',
        ]);
        $found = ReviewPhoto::with('review.product')->where('review_id', $id)->whereKey($photo)->first();
        if (! $found) {
            return response()->json(['message' => 'Photo not found.'], 404);
        }

        DB::transaction(function () use ($found, $data) {
            $hidden = filter_var($data['hidden'], FILTER_VALIDATE_BOOLEAN);
            if ($found->hidden === $hidden) {
                return;
            }
            $found->update(['hidden' => $hidden]);
            $review = $found->review;
            $what = $hidden ? 'hidden' : 'shown';
            $this->audit->record("review.photo_{$what}", 'Photo '.($found->position + 1)." of review #{$review->id} on product {$review->product?->sku} {$what}.",
                'review', $review->id, ['before' => ['photo_id' => $found->id, 'hidden' => ! $hidden], 'after' => ['photo_id' => $found->id, 'hidden' => $hidden]]);
        });

        return response()->json(['data' => self::item(Review::with(['product', 'customer', 'photos'])->find($id))]);
    }

    /** POST /api/admin/v1/reviews/bulk { ids: [1..200], status } → { data: { updated } } (all or nothing) */
    public function bulk(Request $request): JsonResponse
    {
        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:200'],
            'ids.*' => ['integer', 'min:1', 'distinct'],
            'status' => ['required', Rule::in(Review::STATUSES)],
        ], ['ids.required' => 'Select at least one review.', 'ids.max' => 'Select at most 200 reviews at a time.']);

        $updated = DB::transaction(function () use ($data) {
            $ids = array_map('intval', $data['ids']);
            $reviews = Review::with('product')->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
            $missing = array_values(array_diff($ids, $reviews->pluck('id')->all()));
            if ($missing) {
                throw ValidationException::withMessages(['ids' => 'These reviews no longer exist: '.implode(', ', $missing).'.']);
            }
            $updated = 0;
            foreach ($reviews as $review) {
                $updated += $this->reviews->setStatus($review, $data['status']) ? 1 : 0;
            }

            return $updated;
        });

        return response()->json(['data' => ['updated' => $updated]]);
    }

    /** DELETE /api/admin/v1/reviews/{id} → 204 (phase 22: its photo files go too, after the commit). */
    public function destroy(int $id): JsonResponse
    {
        $review = Review::with('product')->find($id);
        if (! $review) {
            return $this->notFound();
        }
        DB::transaction(fn () => $this->reviews->delete($review));

        return response()->json(null, 204);
    }

    /** A review as staff see it. */
    public static function item(Review $review): array
    {
        $customer = $review->customer;

        return [
            'id' => $review->id,
            'status' => $review->status,
            'rating' => $review->rating,
            'title' => $review->title,
            'comment' => $review->comment,
            'author_name' => $review->author_name,
            'verified_purchase' => $review->verified_purchase,
            'product' => $review->product ? [
                'id' => $review->product->id,
                'name' => $review->product->name,
                'sku' => $review->product->sku,
                'thumbnail_url' => $review->product->thumbnail_url,
            ] : null,
            'customer' => $customer ? [
                'id' => $customer->id,
                'name' => trim("{$customer->first_name} {$customer->last_name}"),
                'email' => $customer->email,
            ] : null,
            'created_at' => $review->created_at?->toIso8601ZuluString(),
            'updated_at' => $review->updated_at?->toIso8601ZuluString(),
            // Phase 22: every photo, hidden ones too (the bytes: GET reviews/{id}/photos/{photo}).
            'photos' => $review->photos->map(fn (ReviewPhoto $photo) => [
                'id' => $photo->id,
                'hidden' => $photo->hidden,
                'width' => $photo->width,
                'height' => $photo->height,
                'size_bytes' => $photo->size_bytes,
                'position' => $photo->position,
            ])->values()->all(),
        ];
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Review not found.'], 404);
    }
}
