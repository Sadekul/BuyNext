<?php

namespace Tests\Support;

use RuntimeException;

/**
 * Phase 22: tiny real images made in the tests (GD), and hidden data spliced
 * into them: an EXIF block with a GPS position and an orientation flag, PNG
 * text chunks, and WebP EXIF/XMP chunks.
 */
final class TestImages
{
    /** The text that marks the hidden data (no clean photo contains it). */
    public const GPS_TEXT = 'GPS 23.8103 N 90.4125 E';

    public static function png(int $width = 40, int $height = 30, bool $transparent = false): string
    {
        $image = imagecreatetruecolor($width, $height);
        imagealphablending($image, false);
        imagesavealpha($image, true);
        imagefill($image, 0, 0, $transparent ? imagecolorallocatealpha($image, 4, 120, 87, 100) : imagecolorallocate($image, 4, 120, 87));

        return self::capture(fn () => imagepng($image));
    }

    public static function jpeg(int $width = 40, int $height = 30): string
    {
        $image = imagecreatetruecolor($width, $height);
        imagefill($image, 0, 0, imagecolorallocate($image, 194, 65, 12));

        return self::capture(fn () => imagejpeg($image, null, 90));
    }

    public static function webp(int $width = 40, int $height = 30): string
    {
        $image = imagecreatetruecolor($width, $height);
        imagefill($image, 0, 0, imagecolorallocate($image, 4, 120, 87));

        return self::capture(fn () => imagewebp($image, null, 80));
    }

    /** A JPEG with an EXIF APP1 segment (orientation, GPS latitude, a description with GPS_TEXT) and a comment, spliced in after SOI. */
    public static function jpegWithGps(int $width = 40, int $height = 30, int $orientation = 1): string
    {
        $jpeg = self::jpeg($width, $height);
        $exif = "Exif\0\0".self::tiff($orientation);
        $app1 = "\xFF\xE1".pack('n', strlen($exif) + 2).$exif;
        $comment = 'Shot at '.self::GPS_TEXT;
        $com = "\xFF\xFE".pack('n', strlen($comment) + 2).$comment;

        return substr($jpeg, 0, 2).$app1.$com.substr($jpeg, 2);
    }

    /** A PNG with tEXt (the GPS text), eXIf, iTXt and tIME chunks after IHDR. */
    public static function pngWithText(int $width = 40, int $height = 30): string
    {
        $png = self::png($width, $height);
        $ihdrEnd = 8 + 12 + 13; // signature, then IHDR (13 data bytes)
        $extra = self::pngChunk('tEXt', "Comment\0".self::GPS_TEXT)
            .self::pngChunk('eXIf', self::tiff(1))
            .self::pngChunk('iTXt', "XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta>".self::GPS_TEXT.'</x:xmpmeta>')
            .self::pngChunk('tIME', pack('nCCCCC', 2026, 11, 28, 10, 0, 0));

        return substr($png, 0, $ihdrEnd).$extra.substr($png, $ihdrEnd);
    }

    /** An extended WebP: VP8X (EXIF and XMP flags on) + the image + EXIF (odd size, padded) + "XMP ". */
    public static function webpWithMetadata(int $width = 40, int $height = 30): string
    {
        $simple = self::webp($width, $height);
        $image = substr($simple, 12); // the VP8 chunk
        $flags = 0x08 | 0x04;
        $vp8x = 'VP8X'.pack('V', 10).chr($flags)."\0\0\0".substr(pack('V', $width - 1), 0, 3).substr(pack('V', $height - 1), 0, 3);
        $exifData = self::tiff(1).'X'; // an odd size: needs a pad byte
        $exif = 'EXIF'.pack('V', strlen($exifData)).$exifData.(strlen($exifData) % 2 ? "\0" : '');
        $xmpData = '<x:xmpmeta>'.self::GPS_TEXT.'</x:xmpmeta>';
        $xmp = 'XMP '.pack('V', strlen($xmpData)).$xmpData.(strlen($xmpData) % 2 ? "\0" : '');
        $chunks = $vp8x.$image.$exif.$xmp;

        return 'RIFF'.pack('V', 4 + strlen($chunks)).'WEBP'.$chunks;
    }

    public static function pngChunk(string $type, string $data): string
    {
        return pack('N', strlen($data)).$type.$data.pack('N', crc32($type.$data));
    }

    /**
     * A big-endian TIFF block: IFD0 with ImageDescription (GPS_TEXT), Orientation and a GPS IFD
     * pointer; the GPS IFD has GPSLatitudeRef "N".
     */
    public static function tiff(int $orientation): string
    {
        $description = self::GPS_TEXT."\0";
        $ifd0 = 8;
        $gpsIfd = $ifd0 + 2 + 3 * 12 + 4; // 50
        $text = $gpsIfd + 2 + 12 + 4; // 68

        return 'MM'.pack('n', 42).pack('N', $ifd0)
            .pack('n', 3)
            .pack('nnNN', 0x010E, 2, strlen($description), $text) // ImageDescription (ASCII)
            .pack('nnN', 0x0112, 3, 1).pack('nn', $orientation, 0) // Orientation (SHORT)
            .pack('nnNN', 0x8825, 4, 1, $gpsIfd) // GPS IFD pointer (LONG)
            .pack('N', 0)
            .pack('n', 1)
            .pack('nnN', 0x0001, 2, 2).'N'."\0\0\0" // GPSLatitudeRef "N"
            .pack('N', 0)
            .$description;
    }

    private static function capture(callable $encode): string
    {
        ob_start();
        $ok = $encode();
        $bytes = (string) ob_get_clean();
        if (! $ok || $bytes === '') {
            throw new RuntimeException('GD could not make the test image.');
        }

        return $bytes;
    }
}
