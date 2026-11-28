<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

/**
 * Phase 22: a customer's photo on a review. The file lives on the private
 * `local` disk (`path` = review-photos/{review_id}/{name}), never the public
 * one: the store only gets it through GET /api/v1/review-photos/{name}, which
 * checks that the review is approved and the photo isn't hidden.
 */
#[Fillable(['review_id', 'name', 'path', 'width', 'height', 'size_bytes', 'position', 'hidden'])]
class ReviewPhoto extends Model
{
    public const MAX_KILOBYTES = 5120;

    /** The longest side, in pixels, a stored photo can have. */
    public const MAX_SIDE = 1600;

    /** A photo's stored name: 32 random hex characters and the type's extension. */
    public const NAME_PATTERN = '/^[a-f0-9]{32}\.(jpg|png|webp)$/';

    public const CONTENT_TYPES = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];

    protected function casts(): array
    {
        return ['width' => 'integer', 'height' => 'integer', 'size_bytes' => 'integer', 'position' => 'integer', 'hidden' => 'boolean'];
    }

    public function review(): BelongsTo
    {
        return $this->belongsTo(Review::class);
    }

    /** The store's address for it (through the sign-in service's /media). */
    public function url(): string
    {
        return "/media/reviews/{$this->name}";
    }

    public function contentType(): string
    {
        return self::CONTENT_TYPES[pathinfo($this->name, PATHINFO_EXTENSION)] ?? 'application/octet-stream';
    }

    /** Removes the files of these photos (call after their rows are gone, e.g. in DB::afterCommit). */
    public static function deleteFiles(iterable $photos): void
    {
        $paths = [];
        foreach ($photos as $photo) {
            $paths[] = $photo->path;
        }
        if (! $paths) {
            return;
        }
        $disk = Storage::disk('local');
        $disk->delete($paths);
        // The review's folder too, once it is empty.
        foreach (array_unique(array_map('dirname', $paths)) as $folder) {
            if ($folder !== '.' && $disk->files($folder) === []) {
                $disk->deleteDirectory($folder);
            }
        }
    }
}
