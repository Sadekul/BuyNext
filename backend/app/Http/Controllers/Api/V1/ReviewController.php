<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\ProductResource;
use App\Models\Order;
use App\Models\Product;
use App\Models\Review;
use App\Services\Reviews;
use App\Services\Settings;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Customers writing reviews. Staff approve them first unless Settings → Catalog says otherwise. */
class ReviewController extends Controller
{
    /**
     * POST /api/v1/products/{id}/reviews { rating 1-5, title?, comment } (customer token)
     * → 201 { data: { ...review, status } }. One per customer per product: 422 code already_reviewed.
     */
    public function store(Request $request, int $id, Settings $settings, Reviews $reviews): JsonResponse
    {
        $product = Product::forSale()->find($id);
        if (! $product) {
            return response()->json(['message' => 'Product not found.'], 404);
        }

        // Plain text only: HTML is removed before the lengths are checked.
        $request->merge([
            'title' => Reviews::plainText(is_string($request->input('title')) ? $request->input('title') : null),
            'comment' => is_string($request->input('comment')) ? (Reviews::plainText($request->input('comment')) ?? '') : $request->input('comment'),
        ]);
        $data = $request->validate([
            'rating' => ['required', 'integer', 'min:1', 'max:5'],
            'title' => ['nullable', 'string', 'max:120'],
            'comment' => ['required', 'string', 'min:10', 'max:2000'],
        ], [
            'rating.required' => 'Choose a rating from 1 to 5 stars.',
            'rating.min' => 'Choose a rating from 1 to 5 stars.',
            'rating.max' => 'Choose a rating from 1 to 5 stars.',
            'title.max' => 'The title can be at most 120 characters.',
            'comment.required' => 'Write a few words about the product.',
            'comment.min' => 'The review must be at least 10 characters.',
            'comment.max' => 'The review can be at most 2,000 characters.',
        ]);

        $customer = $request->user();
        if (Review::where('product_id', $product->id)->where('customer_id', $customer->id)->exists()) {
            return $this->alreadyReviewed();
        }

        $verified = Order::where('customer_id', $customer->id)->where('status', '!=', 'cancelled')
            ->whereHas('items', fn ($q) => $q->where('product_id', $product->id))->exists();
        $status = $settings->get('reviews_require_approval') ? 'pending' : 'approved';

        try {
            $review = DB::transaction(function () use ($product, $customer, $data, $verified, $status, $reviews) {
                $review = Review::create([
                    'product_id' => $product->id,
                    'customer_id' => $customer->id,
                    'status' => $status,
                    // "Nadia R.": the first name and the last name's initial.
                    'author_name' => trim($customer->first_name.' '.mb_substr((string) $customer->last_name, 0, 1).($customer->last_name ? '.' : '')),
                    'rating' => (int) $data['rating'],
                    'title' => $data['title'] ?? null,
                    'comment' => $data['comment'],
                    'verified_purchase' => $verified,
                    'created_at' => now(),
                ]);
                if ($status === 'approved') {
                    $reviews->refresh($product->id);
                }

                return $review;
            });
        } catch (UniqueConstraintViolationException) {
            return $this->alreadyReviewed(); // two submits at once
        }

        return response()->json(['data' => [...ProductResource::publicReview($review), 'status' => $review->status]], 201);
    }

    private function alreadyReviewed(): JsonResponse
    {
        return response()->json([
            'message' => 'You have already reviewed this product.',
            'code' => 'already_reviewed',
            'errors' => ['product' => ['You have already reviewed this product.']],
        ], 422);
    }
}
