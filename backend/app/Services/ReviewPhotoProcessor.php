<?php

namespace App\Services;

use App\Models\ReviewPhoto;
use App\Support\ImageMetadata;
use GdImage;
use InvalidArgumentException;
use Throwable;

/**
 * Phase 22: cleans a customer's review photo before it is stored, so it can't
 * give away where or with what it was taken.
 *
 * With GD (this computer's PHP and the production image): the photo is
 * decoded, turned upright (the JPEG orientation flag, as ImageResizer does),
 * shrunk so the longest side is at most ReviewPhoto::MAX_SIDE pixels (never
 * enlarged) and encoded again in the same format. Encoding again drops every
 * piece of hidden data.
 *
 * Without GD: App\Support\ImageMetadata::strip() removes the hidden data and
 * keeps the pixels as they are (no shrinking).
 *
 * strip() also runs on GD's output, as a second safety step.
 *
 * A photo that can't be read throws InvalidArgumentException (the caller
 * answers 422 for that file, never 500).
 */
class ReviewPhotoProcessor
{
    private const JPEG_QUALITY = 82;

    private const WEBP_QUALITY = 80;

    /** $useGd: null = use GD when it is installed; false forces the pure-PHP way (tests). */
    public function __construct(private ImageResizer $resizer, private ?bool $useGd = null) {}

    public function usesGd(): bool
    {
        return $this->useGd ?? $this->resizer->available();
    }

    /**
     * $ext: jpg, png or webp (from ImageSniffer, never the file's name).
     *
     * @return array{bytes: string, ext: string, width: int, height: int}
     */
    public function process(string $tmpPath, string $ext): array
    {
        if (! isset(ReviewPhoto::CONTENT_TYPES[$ext])) {
            throw new InvalidArgumentException("Unknown photo type {$ext}.");
        }
        $bytes = @file_get_contents($tmpPath);
        if ($bytes === false || $bytes === '') {
            throw new InvalidArgumentException('The photo could not be read.');
        }

        try {
            $clean = $this->usesGd() ? ImageMetadata::strip($this->reencode($bytes, $ext), $ext) : ImageMetadata::strip($bytes, $ext);
            $info = @getimagesizefromstring($clean);
        } catch (Throwable $e) {
            throw new InvalidArgumentException('The photo could not be read.', 0, $e);
        }
        if ($info === false || $info[0] < 1 || $info[1] < 1) {
            throw new InvalidArgumentException('The cleaned photo is not a readable image.');
        }

        return ['bytes' => $clean, 'ext' => $ext, 'width' => (int) $info[0], 'height' => (int) $info[1]];
    }

    private function reencode(string $bytes, string $ext): string
    {
        $info = @getimagesizefromstring($bytes);
        if ($info === false) {
            throw new InvalidArgumentException('Not a readable image.');
        }
        $orientation = $ext === 'jpg' ? $this->resizer->jpegOrientation($bytes) : 1;
        $this->resizer->ensureMemory((int) $info[0], (int) $info[1]);
        $source = @imagecreatefromstring($bytes);
        unset($bytes);
        if (! $source instanceof GdImage) {
            throw new InvalidArgumentException('The image could not be decoded.');
        }
        $source = $this->resizer->orient($source, $orientation);

        $width = imagesx($source);
        $height = imagesy($source);
        $scale = min(1, ReviewPhoto::MAX_SIDE / max($width, $height));
        $targetWidth = max(1, (int) round($width * $scale));
        $targetHeight = max(1, (int) round($height * $scale));

        $copy = imagecreatetruecolor($targetWidth, $targetHeight);
        if ($ext === 'jpg') {
            // No transparency in a JPEG: a white background (never black) under any see-through pixels.
            imagefill($copy, 0, 0, imagecolorallocate($copy, 255, 255, 255));
        } else {
            imagealphablending($copy, false);
            imagesavealpha($copy, true);
            imagefill($copy, 0, 0, imagecolorallocatealpha($copy, 0, 0, 0, 127));
        }
        imagecopyresampled($copy, $source, 0, 0, 0, 0, $targetWidth, $targetHeight, $width, $height);
        unset($source);

        ob_start();
        $ok = match ($ext) {
            'webp' => imagewebp($copy, null, self::WEBP_QUALITY),
            'png' => imagepng($copy, null, 9),
            default => imagejpeg($copy, null, self::JPEG_QUALITY),
        };
        $data = (string) ob_get_clean();
        if (! $ok || $data === '') {
            throw new InvalidArgumentException("The photo couldn't be encoded as {$ext}.");
        }

        return $data;
    }
}
