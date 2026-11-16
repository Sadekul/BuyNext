<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminProductResource;
use App\Models\Product;
use App\Models\ProductImage;
use App\Services\Audit;
use App\Support\ImageSniffer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

/**
 * Uploaded product images (products.edit). Files are checked by their
 * contents (JPEG, PNG, WebP only: never the name or the browser's type),
 * stored on the `public` disk as products/{product_id}/{32 random hex}.{ext},
 * and served by the store at /media/products/{product_id}/{name}.
 * The product's thumbnail follows the first image.
 *
 * Every answer is { data: [image items] } in gallery order:
 * { id, url, alt, position, is_upload }.
 */
class ProductImageController extends Controller
{
    public const MAX_FILES_PER_REQUEST = 10;

    public const MAX_KILOBYTES = 5120;

    public function __construct(private Audit $audit) {}

    /** POST /api/admin/v1/products/{id}/images (multipart, images[]) → 201 */
    public function store(Request $request, int $id): JsonResponse
    {
        $product = Product::find($id);
        if (! $product) {
            return $this->notFound();
        }
        $request->validate([
            'images' => ['required', 'array', 'min:1', 'max:'.self::MAX_FILES_PER_REQUEST],
            'images.*' => ['required', 'file', 'max:'.self::MAX_KILOBYTES],
        ], [
            'images.required' => 'Choose at least one image.',
            'images.max' => 'Upload at most '.self::MAX_FILES_PER_REQUEST.' images at a time.',
            'images.*.file' => 'This isn\'t a file that was uploaded.',
            'images.*.uploaded' => 'This file couldn\'t be uploaded (at most 5 MB).',
            'images.*.max' => 'Each image can be at most 5 MB.',
        ]);

        /** @var list<UploadedFile> $files */
        $files = array_values($request->file('images'));
        $types = [];
        $errors = [];
        foreach ($files as $index => $file) {
            $problem = null;
            $type = ImageSniffer::detect($file->getRealPath(), $problem);
            if ($type === null) {
                $errors["images.{$index}"] = "{$file->getClientOriginalName()}: {$problem}";
            }
            $types[$index] = $type;
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        $stored = [];
        try {
            DB::transaction(function () use ($product, $files, $types, &$stored) {
                // Lock the product: two uploads at once can't both pass the limit.
                Product::whereKey($product->id)->lockForUpdate()->first();
                $count = $product->images()->count();
                if ($count + count($files) > Product::MAX_IMAGES) {
                    $left = max(0, Product::MAX_IMAGES - $count);
                    throw ValidationException::withMessages(['images' => 'A product can have at most '.Product::MAX_IMAGES." images; this one has {$count}, so you can add {$left} more."]);
                }

                $position = (int) $product->images()->max('position') + ($count > 0 ? 1 : 0);
                foreach ($files as $index => $file) {
                    $name = bin2hex(random_bytes(16)).'.'.$types[$index];
                    // The original bytes, under a name we chose (never the uploader's).
                    $path = Storage::disk('public')->putFileAs("products/{$product->id}", $file, $name);
                    if ($path === false) {
                        throw new \RuntimeException('The image could not be saved.');
                    }
                    $stored[] = $path;
                    $product->images()->create([
                        'url' => "/media/products/{$product->id}/{$name}",
                        'path' => $path,
                        'alt' => $product->name,
                        'position' => $position++,
                    ]);
                }
                $product->syncThumbnail();
                $this->audit->record('product.images_added', count($files).' '.str('image')->plural(count($files))." added to product {$product->sku}.",
                    'product', $product->id, ['before' => [], 'after' => ['images' => $product->images()->pluck('url')->all()]]);
            });
        } catch (\Throwable $e) {
            // Nothing was saved: don't keep the files either.
            Storage::disk('public')->delete($stored);
            throw $e;
        }

        return response()->json(['data' => $this->items($product)], 201);
    }

    /** PATCH /api/admin/v1/products/{id}/images/{image} { alt } */
    public function update(Request $request, int $id, int $image): JsonResponse
    {
        $found = $this->findImage($id, $image);
        if (! $found) {
            return $this->notFound();
        }
        $data = $request->validate(['alt' => ['present', 'nullable', 'string', 'max:190']]);
        $alt = trim((string) $data['alt']) ?: null;

        DB::transaction(function () use ($found, $alt) {
            $before = $found->alt;
            $found->update(['alt' => $alt]);
            if ($before !== $alt) {
                $this->audit->record('product.image_updated', "Image alt text changed on product {$found->product->sku}.", 'product', $found->product_id,
                    ['before' => ['alt' => $before, 'url' => $found->url], 'after' => ['alt' => $alt, 'url' => $found->url]]);
            }
        });

        return response()->json(['data' => $this->items($found->product)]);
    }

    /** DELETE /api/admin/v1/products/{id}/images/{image} - also deletes the file. */
    public function destroy(int $id, int $image): JsonResponse
    {
        $found = $this->findImage($id, $image);
        if (! $found) {
            return $this->notFound();
        }

        DB::transaction(function () use ($found) {
            $product = $found->product;
            $found->delete();
            // Close the gap: positions stay 0, 1, 2...
            foreach ($product->images()->get()->values() as $position => $image) {
                $image->update(['position' => $position]);
            }
            $product->syncThumbnail();
            $this->audit->record('product.image_deleted', "Image removed from product {$product->sku}.", 'product', $product->id,
                ['before' => ['image' => $found->url], 'after' => []]);
            DB::afterCommit(fn () => $found->deleteFile());
        });

        return response()->json(['data' => $this->items($found->product)]);
    }

    /** POST /api/admin/v1/products/{id}/images/reorder { ids: [every image id, in the new order] } */
    public function reorder(Request $request, int $id): JsonResponse
    {
        $product = Product::find($id);
        if (! $product) {
            return $this->notFound();
        }
        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:'.Product::MAX_IMAGES],
            'ids.*' => ['integer', 'distinct'],
        ], ['ids.*.distinct' => 'Each image can be listed only once.']);

        DB::transaction(function () use ($product, $data) {
            $images = $product->images()->lockForUpdate()->get()->keyBy('id');
            $ids = array_map('intval', $data['ids']);
            if (count($ids) !== $images->count() || array_diff($ids, $images->keys()->all()) !== []) {
                throw ValidationException::withMessages(['ids' => 'List every image of this product exactly once.']);
            }
            $before = $images->pluck('url')->all();
            foreach ($ids as $position => $imageId) {
                $images[$imageId]->update(['position' => $position]);
            }
            $product->syncThumbnail();
            $after = $product->images()->pluck('url')->all();
            if ($before !== $after) {
                $this->audit->record('product.images_reordered', "Images reordered on product {$product->sku}.", 'product', $product->id,
                    ['before' => ['images' => $before], 'after' => ['images' => $after]]);
            }
        });

        return response()->json(['data' => $this->items($product)]);
    }

    private function findImage(int $productId, int $imageId): ?ProductImage
    {
        return ProductImage::with('product')->where('product_id', $productId)->whereKey($imageId)
            ->whereHas('product')->first();
    }

    private function items(Product $product): array
    {
        return $product->images()->get()->map(fn ($image) => AdminProductResource::image($image))->values()->all();
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Not found.'], 404);
    }
}
