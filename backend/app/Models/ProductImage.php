<?php

namespace App\Models;

use App\Services\ImageResizer;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

/**
 * One gallery image of a product (ordered by position). Uploaded images have
 * a `path` on the `public` disk and a store-relative url (/media/products/...);
 * imported ones only have an external url.
 *
 * Phase 9 (part B): `variants` holds the resized copies of an upload
 * ({ "320": url, "960": url }, see App\Support\ImageVariants); they are
 * deleted with the original.
 */
#[Fillable(['product_id', 'url', 'path', 'variants', 'alt', 'position'])]
class ProductImage extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return ['position' => 'integer', 'variants' => 'array'];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function isUpload(): bool
    {
        return $this->path !== null;
    }

    /** Removes the uploaded file (if any) and its resized copies. Call after the row is deleted. */
    public function deleteFile(): void
    {
        if ($this->path) {
            Storage::disk('public')->delete($this->path);
        }
        app(ImageResizer::class)->deleteCopies($this);
    }
}
