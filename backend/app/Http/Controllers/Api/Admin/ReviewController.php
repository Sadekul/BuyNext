<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminReviewResource;
use App\Models\Review;
use App\Services\Reviews;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Review moderation (Magento's Marketing → Reviews): reviews.view to read,
 * reviews.moderate to approve, reject, or delete. Every change is audited and
 * keeps the product's rating and review count equal to its approved reviews.
 */
class ReviewController extends Controller
{
    public function __construct(private Reviews $reviews) {}

    /** GET /api/admin/v1/reviews?status&product_id&rating&search&page&per_page - newest first. */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'status' => ['nullable', Rule::in(Review::STATUSES)],
            'product_id' => ['nullable', 'integer', 'min:1'],
            'rating' => ['nullable', 'integer', 'min:1', 'max:5'],
            'search' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $page = Review::with(['product', 'customer'])
            ->when($data['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when($data['product_id'] ?? null, fn ($q, $id) => $q->where('product_id', $id))
            ->when($data['rating'] ?? null, fn ($q, $rating) => $q->where('rating', $rating))
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

        return response()->json(['data' => self::item($review->fresh(['product', 'customer']))]);
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

    /** DELETE /api/admin/v1/reviews/{id} → 204 */
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
        ];
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Review not found.'], 404);
    }
}
