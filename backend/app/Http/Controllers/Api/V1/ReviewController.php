<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\ProductResource;
use App\Models\Order;
use App\Models\Product;
use App\Models\Review;
use App\Models\ReviewPhoto;
use App\Services\ReviewPhotoProcessor;
use App\Services\Reviews;
use App\Services\RewardPoints;
use App\Services\Settings;
use App\Support\ImageSniffer;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * Customers writing reviews. Staff approve them first unless Settings → Catalog says otherwise.
 * Phase 22: with Settings → Catalog → review_photos_enabled, up to 3 photos per review (always
 * checked by staff first), and the public address of a photo once its review is approved.
 */
class ReviewController extends Controller
{
    /**
     * POST /api/v1/products/{id}/reviews { rating 1-5, title?, comment } (customer token)
     * → 201 { data: { ...review, status } }. One per customer per product: 422 code already_reviewed.
     *
     * Phase 22: also multipart/form-data with photos[] (0–3 files, JPEG/PNG/WebP, 5 MB each). Every
     * photo is checked and cleaned before anything is saved (all or nothing); a review with photos is
     * always pending. Photos while the setting is off: 422 code photos_disabled.
     */
    public function store(Request $request, int $id, Settings $settings, Reviews $reviews, ReviewPhotoProcessor $processor): JsonResponse
    {
        $product = Product::forSale()->find($id);
        if (! $product) {
            return response()->json(['message' => __('Product not found.')], 404);
        }

        $sentPhotos = $request->files->has('photos') || $request->has('photos');
        if ($sentPhotos && ! $settings->get('review_photos_enabled')) {
            return response()->json([
                'message' => __('Photos can\'t be added to reviews.'),
                'code' => 'photos_disabled',
                'errors' => ['photos' => [__('Photos can\'t be added to reviews.')]],
            ], 422);
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
            // Phase 22 (only reachable while the setting is on).
            'photos' => ['sometimes', 'array', 'max:'.Review::MAX_PHOTOS],
            'photos.*' => ['file', 'max:'.ReviewPhoto::MAX_KILOBYTES],
        ], [
            'rating.required' => __('Choose a rating from 1 to 5 stars.'),
            'rating.min' => __('Choose a rating from 1 to 5 stars.'),
            'rating.max' => __('Choose a rating from 1 to 5 stars.'),
            'title.max' => __('The title can be at most 120 characters.'),
            'comment.required' => __('Write a few words about the product.'),
            'comment.min' => __('The review must be at least 10 characters.'),
            'comment.max' => __('The review can be at most 2,000 characters.'),
            'photos.array' => __('Only JPEG, PNG or WebP photos can be added.'),
            'photos.max' => __('Add at most 3 photos.'),
            'photos.*.file' => __('Only JPEG, PNG or WebP photos can be added.'),
            'photos.*.uploaded' => __('Each photo can be at most 5 MB.'),
            'photos.*.max' => __('Each photo can be at most 5 MB.'),
        ]);

        $customer = $request->user();
        if (Review::where('product_id', $product->id)->where('customer_id', $customer->id)->exists()) {
            return $this->alreadyReviewed();
        }

        $verified = Order::where('customer_id', $customer->id)->where('status', '!=', 'cancelled')
            ->whereHas('items', fn ($q) => $q->where('product_id', $product->id))->exists();
        // Phase 22: every photo is checked and cleaned before anything is written.
        $photos = $this->cleanPhotos(array_values($request->file('photos') ?? []), $processor);
        // Phase 22 (Q2): a photo can show anything, so a review with photos always waits for staff.
        $status = $photos || $settings->get('reviews_require_approval') ? 'pending' : 'approved';

        $written = [];
        try {
            $review = DB::transaction(function () use ($product, $customer, $data, $verified, $status, $reviews, $photos, &$written) {
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
                foreach ($photos as $position => $photo) {
                    $name = bin2hex(random_bytes(16)).'.'.$photo['ext'];
                    $path = "review-photos/{$review->id}/{$name}";
                    if (! Storage::disk('local')->put($path, $photo['bytes'])) {
                        throw new \RuntimeException('The photo could not be saved.');
                    }
                    $written[] = $path;
                    $review->photos()->create([
                        'name' => $name,
                        'path' => $path,
                        'width' => $photo['width'],
                        'height' => $photo['height'],
                        'size_bytes' => strlen($photo['bytes']),
                        'position' => $position,
                    ]);
                }
                if ($status === 'approved') {
                    $reviews->refresh($product->id);
                    app(RewardPoints::class)->review($review); // phase 11: the review bonus
                }

                return $review;
            });
        } catch (\Throwable $e) {
            // Nothing was saved: don't keep the files either.
            if ($written) {
                Storage::disk('local')->delete($written);
            }
            if ($e instanceof UniqueConstraintViolationException) {
                return $this->alreadyReviewed(); // two submits at once
            }
            throw $e;
        }

        return response()->json(['data' => [...ProductResource::publicReview($review->load('photos')), 'status' => $review->status]], 201);
    }

    /**
     * Phase 22: GET /api/v1/review-photos/{name} → the photo's bytes, only while it isn't hidden, its
     * review is approved and the review's product isn't deleted. Everything else (including a name that
     * isn't {32 hex}.{jpg|png|webp}) is the same 404, so nobody can tell "pending" from "doesn't exist".
     * A short browser cache: a photo staff hide disappears from the store within minutes.
     */
    public function photo(string $name): Response|JsonResponse
    {
        $photo = preg_match(ReviewPhoto::NAME_PATTERN, $name) ? ReviewPhoto::where('name', $name)->where('hidden', false)
            ->whereHas('review', fn ($q) => $q->where('status', 'approved')->whereHas('product', fn ($p) => $p->withoutTrashed()))->first() : null;
        $bytes = $photo ? Storage::disk('local')->get($photo->path) : null;
        if ($bytes === null) {
            return response()->json(['message' => __('Photo not found.')], 404);
        }

        return self::photoResponse($photo, $bytes, 'public, max-age=300');
    }

    /** The bytes of a review photo with the safety headers (also used by the admin's photo endpoint). */
    public static function photoResponse(ReviewPhoto $photo, string $bytes, string $cacheControl): Response
    {
        return response($bytes, 200, [
            'Content-Type' => $photo->contentType(),
            'Cache-Control' => $cacheControl,
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ]);
    }

    /**
     * Phase 22: sniffs (the type comes from the bytes) and cleans every photo; any problem is a 422
     * for that file (photos.{i}) before anything is saved.
     *
     * @param  list<UploadedFile>  $files
     * @return list<array{bytes: string, ext: string, width: int, height: int}>
     */
    private function cleanPhotos(array $files, ReviewPhotoProcessor $processor): array
    {
        $errors = [];
        $clean = [];
        foreach ($files as $index => $file) {
            $problem = null;
            $type = ImageSniffer::detect($file->getRealPath(), $problem);
            if ($type === null) {
                $errors["photos.{$index}"] = match ($problem) {
                    ImageSniffer::WRONG_TYPE => __('Only JPEG, PNG or WebP photos can be added.'),
                    ImageSniffer::TOO_LARGE => __('Each photo can be at most 6000 × 6000 pixels.'),
                    default => __('This photo couldn\'t be read.'),
                };

                continue;
            }
            try {
                $clean[$index] = $processor->process($file->getRealPath(), $type);
            } catch (InvalidArgumentException) {
                $errors["photos.{$index}"] = __('This photo couldn\'t be read.');
            }
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        return array_values($clean);
    }

    private function alreadyReviewed(): JsonResponse
    {
        return response()->json([
            'message' => __('You have already reviewed this product.'),
            'code' => 'already_reviewed',
            'errors' => ['product' => [__('You have already reviewed this product.')]],
        ], 422);
    }
}
