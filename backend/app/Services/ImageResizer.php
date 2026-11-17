<?php

namespace App\Services;

use App\Models\ProductImage;
use App\Support\ImageVariants;
use GdImage;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * Phase 9 (part B): makes the resized copies of an uploaded product photo
 * (see App\Support\ImageVariants for which sizes and names) with PHP's GD
 * extension. Re-encoding drops the photo's metadata (camera, GPS position);
 * a JPEG's orientation flag is applied first, so copies aren't sideways.
 *
 * Without GD (this development computer) available() is false and nothing is
 * made: uploads keep working with the original only. The production image
 * (backend/Dockerfile) installs GD with JPEG, PNG, and WebP support.
 */
class ImageResizer
{
    private const JPEG_QUALITY = 82;

    private const WEBP_QUALITY = 80;

    /** Can this PHP make copies (GD that reads JPEG, PNG and WebP)? */
    public function available(): bool
    {
        if (! extension_loaded('gd') || ! function_exists('imagecreatefromstring')) {
            return false;
        }
        $info = gd_info();

        return ! empty($info['JPEG Support']) && ! empty($info['PNG Support']) && ! empty($info['WebP Support']);
    }

    /** Can GD write WebP? Then copies are .webp (smaller); otherwise the original format. */
    public function webpAvailable(): bool
    {
        return $this->available() && function_exists('imagewebp');
    }

    /**
     * Makes the copies for $image (an upload) and returns { "320": url, ... }
     * ([] when there's nothing to make or GD is missing). Doesn't save the
     * row. Throws when a file can't be read, decoded, or written; files made
     * before the error are removed.
     */
    public function make(ProductImage $image): array
    {
        if (! $image->path || ! $this->available() || ! preg_match(ImageVariants::ORIGINAL_PATH, $image->path, $match)) {
            return [];
        }
        $disk = Storage::disk('public');
        $bytes = $disk->get($image->path);
        if ($bytes === null) {
            throw new RuntimeException("The image file {$image->path} is missing.");
        }
        $info = @getimagesizefromstring($bytes);
        if ($info === false) {
            throw new RuntimeException("The image file {$image->path} isn't a readable image.");
        }

        $orientation = $match[3] === 'jpg' ? $this->jpegOrientation($bytes) : 1;
        [$width, $height] = in_array($orientation, [5, 6, 7, 8], true) ? [$info[1], $info[0]] : [$info[0], $info[1]];
        $plan = ImageVariants::plan($width, $height);
        if ($plan === []) {
            return [];
        }

        $this->ensureMemory($info[0], $info[1]);
        $source = @imagecreatefromstring($bytes);
        unset($bytes);
        if (! $source instanceof GdImage) {
            throw new RuntimeException("The image file {$image->path} couldn't be decoded.");
        }
        $source = $this->orient($source, $orientation);

        $extension = ImageVariants::extension($match[3], $this->webpAvailable());
        $made = [];
        try {
            foreach ($plan as $size => [$targetWidth, $targetHeight]) {
                $copy = imagecreatetruecolor($targetWidth, $targetHeight);
                imagealphablending($copy, false);
                imagesavealpha($copy, true);
                imagefill($copy, 0, 0, imagecolorallocatealpha($copy, 0, 0, 0, 127));
                imagecopyresampled($copy, $source, 0, 0, 0, 0, $targetWidth, $targetHeight, imagesx($source), imagesy($source));
                $path = ImageVariants::path($image->path, $size, $extension);
                if (! $disk->put($path, $this->encode($copy, $extension))) {
                    throw new RuntimeException("The resized image {$path} could not be saved.");
                }
                $made[(string) $size] = $path;
            }
        } catch (\Throwable $e) {
            $disk->delete(array_values($made));
            throw $e;
        }

        return array_map(fn (string $path) => ImageVariants::url($path), $made);
    }

    /** Removes $image's copies (the original is ProductImage::deleteFile()'s job). */
    public function deleteCopies(ProductImage $image): void
    {
        $paths = array_values(array_filter(array_map(fn ($url) => is_string($url) ? ImageVariants::pathFromUrl($url) : null, (array) $image->variants)));
        if ($paths) {
            Storage::disk('public')->delete($paths);
        }
    }

    private function encode(GdImage $image, string $extension): string
    {
        ob_start();
        $ok = match ($extension) {
            'webp' => imagewebp($image, null, self::WEBP_QUALITY),
            'png' => imagepng($image, null, 9),
            default => imagejpeg($image, null, self::JPEG_QUALITY),
        };
        $data = (string) ob_get_clean();
        if (! $ok || $data === '') {
            throw new RuntimeException("The resized image couldn't be encoded as {$extension}.");
        }

        return $data;
    }

    /** EXIF orientation 1–8 of a JPEG (1 = as stored, or unknown). */
    private function jpegOrientation(string $bytes): int
    {
        if (! function_exists('exif_read_data')) {
            return 1;
        }
        $exif = @exif_read_data('data://image/jpeg;base64,'.base64_encode($bytes));

        return is_array($exif) && isset($exif['Orientation']) ? max(1, min(8, (int) $exif['Orientation'])) : 1;
    }

    /** Turns the pixels so the copy looks like the original does in a browser (which applies the flag). */
    private function orient(GdImage $image, int $orientation): GdImage
    {
        if (in_array($orientation, [2, 4, 5, 7], true)) {
            imageflip($image, IMG_FLIP_HORIZONTAL);
        }
        $angle = match ($orientation) {
            3, 4 => 180,
            5, 6 => -90,
            7, 8 => 90,
            default => 0,
        };
        if ($angle !== 0) {
            $rotated = imagerotate($image, $angle, 0);
            if ($rotated instanceof GdImage) {
                return $rotated;
            }
        }

        return $image;
    }

    /** A 6000×6000 photo needs about 150 MB decoded: raise the limit for this request if needed (at most 1 GB). */
    private function ensureMemory(int $width, int $height): void
    {
        $needed = memory_get_usage() + $width * $height * 5 + 32 * 1024 * 1024;
        $limit = $this->bytes((string) ini_get('memory_limit'));
        if ($limit > 0 && $limit < $needed) {
            ini_set('memory_limit', (string) min($needed, 1024 * 1024 * 1024));
        }
    }

    private function bytes(string $value): int
    {
        $value = trim($value);
        if ($value === '' || $value === '-1') {
            return -1;
        }
        $number = (int) $value;

        return match (strtolower(substr($value, -1))) {
            'g' => $number * 1024 ** 3,
            'm' => $number * 1024 ** 2,
            'k' => $number * 1024,
            default => $number,
        };
    }
}
