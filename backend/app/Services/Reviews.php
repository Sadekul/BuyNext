<?php

namespace App\Services;

use App\Models\Admin;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Review;
use App\Models\ReviewPhoto;
use Illuminate\Support\Facades\DB;

/**
 * Review moderation: changing a review's status (or deleting it) and keeping
 * the product's rating_average and review_count equal to its approved reviews.
 */
class Reviews
{
    public function __construct(private Audit $audit) {}

    /** Call inside a transaction. Returns true when the status changed. */
    public function setStatus(Review $review, string $status, ?Admin $admin = null): bool
    {
        $before = $review->status;
        if ($before === $status) {
            return false;
        }
        $review->update(['status' => $status]);
        $this->audit->record("review.{$status}", "Review #{$review->id} on product {$review->product?->sku} {$status}.", 'review', $review->id,
            ['before' => ['status' => $before], 'after' => ['status' => $status]], $admin);
        if ($before === 'approved' || $status === 'approved') {
            $this->refresh($review->product_id);
        }
        // Phase 11: the review bonus (once per customer and product).
        if ($status === 'approved') {
            app(RewardPoints::class)->review($review);
        }

        return true;
    }

    /**
     * Call inside a transaction. Phase 22: the photo files are deleted once the transaction commits (the rows cascade).
     * Phase 23: $author = the customer deleting their own review (audited as review.deleted_by_customer, no admin,
     * their email in the entry).
     */
    public function delete(Review $review, ?Admin $admin = null, ?Customer $author = null): void
    {
        $photos = $review->photos()->get();
        $review->delete();
        if ($photos->isNotEmpty()) {
            DB::afterCommit(fn () => ReviewPhoto::deleteFiles($photos));
        }
        $before = ['status' => $review->status, 'rating' => $review->rating, 'author_name' => $review->author_name, 'comment' => $review->comment];
        if ($author) {
            $this->audit->record('review.deleted_by_customer', "Review #{$review->id} on product {$review->product?->sku} deleted by its author.", 'review', $review->id,
                ['before' => [...$before, 'photos' => $photos->count(), 'customer_email' => $author->email], 'after' => []]);
        } else {
            $this->audit->record('review.deleted', "Review #{$review->id} on product {$review->product?->sku} deleted.", 'review', $review->id,
                ['before' => $before, 'after' => []], $admin);
        }
        if ($review->status === 'approved') {
            $this->refresh($review->product_id);
        }
    }

    public function refresh(int $productId): void
    {
        Product::withTrashed()->find($productId)?->refreshReviewStats();
    }

    /** Plain text: tags removed, whitespace runs inside lines kept, ends trimmed. */
    public static function plainText(?string $text): ?string
    {
        if ($text === null) {
            return null;
        }
        $text = trim(strip_tags($text));

        return $text === '' ? null : $text;
    }
}
