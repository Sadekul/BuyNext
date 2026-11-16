<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

/**
 * One gallery image of a product (ordered by position). Uploaded images have
 * a `path` on the `public` disk and a store-relative url (/media/products/...);
 * imported ones only have an external url.
 */
#[Fillable(['product_id', 'url', 'path', 'alt', 'position'])]
class ProductImage extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return ['position' => 'integer'];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function isUpload(): bool
    {
        return $this->path !== null;
    }

    /** Removes the uploaded file (if any). Call after the row is deleted. */
    public function deleteFile(): void
    {
        if ($this->path) {
            Storage::disk('public')->delete($this->path);
        }
    }
}
