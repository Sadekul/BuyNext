<?php

namespace App\Support;

use finfo;

/**
 * What an uploaded file really is, from its bytes: never its name or the
 * type the browser claimed. Only JPEG, PNG, and WebP pass, and only when both
 * the magic-bytes check (finfo) and the image header parser (getimagesize)
 * agree on the same type, so an SVG, an HTML page, or a PHP script renamed to
 * .jpg is refused. (This machine has no GD/Imagick, so files are not
 * re-encoded; they are stored under a random name with the detected extension
 * and only ever served as images.)
 */
final class ImageSniffer
{
    public const MAX_DIMENSION = 6000;

    /** The $problem sentences (phase 22: the review photo upload tells them apart). */
    public const WRONG_TYPE = 'Only JPEG, PNG, or WebP images can be uploaded.';

    public const NOT_AN_IMAGE = 'This file isn\'t a valid image.';

    public const TOO_LARGE = 'Images can be at most '.self::MAX_DIMENSION.'×'.self::MAX_DIMENSION.' pixels.';

    private const TYPES = [
        'image/jpeg' => [IMAGETYPE_JPEG, 'jpg'],
        'image/png' => [IMAGETYPE_PNG, 'png'],
        'image/webp' => [IMAGETYPE_WEBP, 'webp'],
    ];

    /** The extension (jpg, png, webp), or null with $problem set to a sentence for the uploader. */
    public static function detect(string $path, ?string &$problem = null): ?string
    {
        $problem = null;
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($path) ?: '';
        if (! isset(self::TYPES[$mime])) {
            $problem = self::WRONG_TYPE;

            return null;
        }
        [$imageType, $extension] = self::TYPES[$mime];

        $info = @getimagesize($path);
        if ($info === false || $info[2] !== $imageType || $info[0] < 1 || $info[1] < 1) {
            $problem = self::NOT_AN_IMAGE;

            return null;
        }
        if ($info[0] > self::MAX_DIMENSION || $info[1] > self::MAX_DIMENSION) {
            $problem = self::TOO_LARGE;

            return null;
        }

        return $extension;
    }
}
