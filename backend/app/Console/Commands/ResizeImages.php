<?php

namespace App\Console\Commands;

use App\Models\Product;
use App\Models\ProductImage;
use App\Services\ImageResizer;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Throwable;

/**
 * Phase 9 (part B): php artisan buynest:images:resize [--force]
 * Makes the resized copies (320 and 960 px wide) for uploaded product photos
 * that don't have them yet: uploads from before phase 9, or made while GD
 * was missing. --force makes them again for every upload (old copies are
 * replaced). Imported photos (external addresses) are never touched.
 * Run it where the photos are: on Railway, the api service (the volume).
 */
#[Signature('buynest:images:resize {--force : Make the copies again for every uploaded photo}')]
#[Description('Make resized copies of uploaded product photos')]
class ResizeImages extends Command
{
    public function handle(ImageResizer $resizer): int
    {
        if (! $resizer->available()) {
            $this->error('GD is not installed (with JPEG, PNG, and WebP support), so photos can\'t be resized here. The production image has it; see backend/Dockerfile.');

            return self::FAILURE;
        }

        $query = ProductImage::whereNotNull('path')->orderBy('id');
        if (! $this->option('force')) {
            $query->whereNull('variants');
        }

        $done = 0;
        $skipped = 0;
        $failed = 0;
        $products = [];
        $query->chunkById(100, function ($images) use ($resizer, &$done, &$skipped, &$failed, &$products) {
            foreach ($images as $image) {
                try {
                    $old = $image->replicate(); // its current copies, to remove after a --force run
                    $old->variants = $image->variants;
                    $variants = $resizer->make($image);
                    $image->update(['variants' => $variants ?: null]);
                    // Copies made before in another format (e.g. .jpg before WebP was available) go.
                    if ($old->variants && array_diff(array_values($old->variants), array_values($variants))) {
                        $old->variants = array_diff($old->variants, $variants);
                        $resizer->deleteCopies($old);
                    }
                    $variants ? $done++ : $skipped++;
                    $products[$image->product_id] = true;
                } catch (Throwable $e) {
                    $failed++;
                    $this->warn("Image {$image->id} ({$image->path}): {$e->getMessage()}");
                }
            }
        });

        // Product cards use the first image's copies.
        Product::withTrashed()->whereIn('id', array_keys($products))->get()->each->syncThumbnail();

        $this->info("Resized {$done} ".str('photo')->plural($done).", {$skipped} already small enough, {$failed} failed.");

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }
}
