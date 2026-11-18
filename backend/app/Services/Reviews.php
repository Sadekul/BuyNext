<?php

namespace App\Services;

use App\Models\Admin;
use App\Models\Product;
use App\Models\Review;

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

    public function delete(Review $review, ?Admin $admin = null): void
    {
        $review->delete();
        $this->audit->record('review.deleted', "Review #{$review->id} on product {$review->product?->sku} deleted.", 'review', $review->id,
            ['before' => ['status' => $review->status, 'rating' => $review->rating, 'author_name' => $review->author_name, 'comment' => $review->comment], 'after' => []], $admin);
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
