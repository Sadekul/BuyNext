<?php

namespace App\Support;

/**
 * Phase 9 (part B): which resized copies an uploaded product photo gets, and
 * what they are called. Pure logic (no GD), so it is tested on any machine;
 * App\Services\ImageResizer does the pixels.
 *
 * Sizes are maximum WIDTHS: the storefront's srcset describes images by
 * width ("…-320.webp 320w"), so a copy must really be that wide. A copy is
 * made only when the original is wider than the size: never upscaled.
 * Names: the original's 32 hex characters plus "-320" / "-960", in the same
 * folder: products/12/<hex>.jpg → products/12/<hex>-320.webp.
 */
final class ImageVariants
{
    public const SIZES = [320, 960];

    /** An original upload's path on the public disk (copies don't match). */
    public const ORIGINAL_PATH = '#^products/(\d+)/([a-f0-9]{32})\.(jpg|png|webp)$#';

    /**
     * The copies to make for an image of $width × $height:
     * [size => [width, height]], smallest first. Heights keep the aspect
     * ratio (rounded, at least 1 px).
     */
    public static function plan(int $width, int $height): array
    {
        $plan = [];
        if ($width < 1 || $height < 1) {
            return $plan;
        }
        foreach (self::SIZES as $size) {
            if ($width > $size) {
                $plan[$size] = [$size, max(1, (int) round($height * $size / $width))];
            }
        }

        return $plan;
    }

    /** The copies' format: WebP when it can be written, otherwise the original's. */
    public static function extension(string $originalExtension, bool $webpAvailable): string
    {
        return $webpAvailable ? 'webp' : $originalExtension;
    }

    /** products/12/<hex>.jpg + 320 + webp → products/12/<hex>-320.webp, or null for a path that isn't an original upload. */
    public static function path(string $originalPath, int $size, string $extension): ?string
    {
        if (! preg_match(self::ORIGINAL_PATH, $originalPath, $match) || ! in_array($size, self::SIZES, true)) {
            return null;
        }

        return "products/{$match[1]}/{$match[2]}-{$size}.{$extension}";
    }

    /** The store address of a file on the public disk: products/12/x.webp → /media/products/12/x.webp. */
    public static function url(string $path): string
    {
        return '/media/'.$path;
    }

    /** /media/products/12/x-320.webp → products/12/x-320.webp (only names this class makes). */
    public static function pathFromUrl(string $url): ?string
    {
        return preg_match('#^/media/(products/\d+/[a-f0-9]{32}-(320|960)\.(jpg|png|webp))$#', $url, $match) ? $match[1] : null;
    }

    /** The JSON value: always an object ({} when there are no copies), keyed by width. */
    public static function forApi(?array $variants): object
    {
        $clean = [];
        foreach (self::SIZES as $size) {
            if (isset($variants[(string) $size]) && is_string($variants[(string) $size])) {
                $clean[(string) $size] = $variants[(string) $size];
            }
        }

        return (object) $clean;
    }
}
