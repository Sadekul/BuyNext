<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * Phase 22: removes the hidden data a photo carries (GPS position, camera,
 * date taken, editing software, comments) without touching its pixels. Pure
 * PHP, so it works without GD; the review photo cleaner also runs it on GD's
 * output as a second safety step.
 *
 * - JPEG: drops APP1 (EXIF and XMP), APP13 (IPTC) and COM segments; keeps APP0
 *   (JFIF), APP2 (the ICC colour profile) and every other segment. Everything
 *   from the first scan (SOS) on is copied unchanged.
 * - PNG: drops the eXIf, tEXt, zTXt, iTXt and tIME chunks.
 * - WebP: drops the EXIF and "XMP " chunks, clears their flag bits in VP8X,
 *   and fixes the RIFF size.
 *
 * A file whose structure is broken throws InvalidArgumentException.
 */
final class ImageMetadata
{
    private const JPEG_DROP = [0xE1, 0xED, 0xFE];

    private const PNG_SIGNATURE = "\x89PNG\r\n\x1a\n";

    private const PNG_DROP = ['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'];

    private const WEBP_DROP = ['EXIF', 'XMP '];

    /** VP8X flag bits (libwebp): EXIF 0x08, XMP 0x04. */
    private const WEBP_EXIF_FLAG = 0x08;

    private const WEBP_XMP_FLAG = 0x04;

    /** $ext: jpg, png or webp (ImageSniffer's names). */
    public static function strip(string $bytes, string $ext): string
    {
        return match ($ext) {
            'jpg', 'jpeg' => self::jpeg($bytes),
            'png' => self::png($bytes),
            'webp' => self::webp($bytes),
            default => throw new InvalidArgumentException("Unknown image type {$ext}."),
        };
    }

    private static function jpeg(string $bytes): string
    {
        $length = strlen($bytes);
        if ($length < 4 || substr($bytes, 0, 2) !== "\xFF\xD8") {
            throw new InvalidArgumentException('Not a JPEG file.');
        }
        $out = "\xFF\xD8";
        $offset = 2;
        while ($offset < $length) {
            if ($bytes[$offset] !== "\xFF") {
                throw new InvalidArgumentException('Broken JPEG segment.');
            }
            // Fill bytes: any number of 0xFF before the marker.
            while ($offset < $length && $bytes[$offset] === "\xFF") {
                $offset++;
            }
            if ($offset >= $length) {
                throw new InvalidArgumentException('Broken JPEG segment.');
            }
            $marker = ord($bytes[$offset]);
            $offset++;
            if ($marker === 0xD9) { // EOI
                return $out."\xFF\xD9";
            }
            if ($marker === 0x01 || ($marker >= 0xD0 && $marker <= 0xD7)) { // no length
                $out .= "\xFF".chr($marker);

                continue;
            }
            if ($offset + 2 > $length) {
                throw new InvalidArgumentException('Broken JPEG segment.');
            }
            $size = unpack('n', $bytes, $offset)[1];
            if ($size < 2 || $offset + $size > $length) {
                throw new InvalidArgumentException('Broken JPEG segment.');
            }
            if ($marker === 0xDA) { // SOS: the image data follows; copy the rest as it is.
                return $out."\xFF\xDA".substr($bytes, $offset);
            }
            if (! in_array($marker, self::JPEG_DROP, true)) {
                $out .= "\xFF".chr($marker).substr($bytes, $offset, $size);
            }
            $offset += $size;
        }

        throw new InvalidArgumentException('The JPEG file has no image data.');
    }

    private static function png(string $bytes): string
    {
        $length = strlen($bytes);
        if (! str_starts_with($bytes, self::PNG_SIGNATURE)) {
            throw new InvalidArgumentException('Not a PNG file.');
        }
        $out = self::PNG_SIGNATURE;
        $offset = 8;
        while ($offset + 12 <= $length) {
            $size = unpack('N', $bytes, $offset)[1];
            $type = substr($bytes, $offset + 4, 4);
            $total = 12 + $size;
            if ($size > 0x7FFFFFFF || $offset + $total > $length) {
                throw new InvalidArgumentException('Broken PNG chunk.');
            }
            if (! in_array($type, self::PNG_DROP, true)) {
                $out .= substr($bytes, $offset, $total);
            }
            $offset += $total;
            if ($type === 'IEND') {
                return $out;
            }
        }

        throw new InvalidArgumentException('The PNG file has no end.');
    }

    private static function webp(string $bytes): string
    {
        $length = strlen($bytes);
        if ($length < 12 || substr($bytes, 0, 4) !== 'RIFF' || substr($bytes, 8, 4) !== 'WEBP') {
            throw new InvalidArgumentException('Not a WebP file.');
        }
        // The RIFF size says where the file ends; anything after it is ignored.
        $end = min($length, 8 + unpack('V', $bytes, 4)[1]);
        $chunks = '';
        $offset = 12;
        while ($offset + 8 <= $end) {
            $type = substr($bytes, $offset, 4);
            $size = unpack('V', $bytes, $offset + 4)[1];
            $total = 8 + $size + ($size % 2); // chunks are padded to an even size
            if ($offset + 8 + $size > $end) {
                throw new InvalidArgumentException('Broken WebP chunk.');
            }
            $chunk = substr($bytes, $offset, min($total, $end - $offset));
            if (strlen($chunk) < $total) {
                $chunk .= "\0"; // a missing final pad byte
            }
            if ($type === 'VP8X' && $size >= 1) {
                $chunk[8] = chr(ord($chunk[8]) & ~(self::WEBP_EXIF_FLAG | self::WEBP_XMP_FLAG) & 0xFF);
            }
            if (! in_array($type, self::WEBP_DROP, true)) {
                $chunks .= $chunk;
            }
            $offset += $total;
        }
        if ($chunks === '') {
            throw new InvalidArgumentException('The WebP file has no image data.');
        }

        return 'RIFF'.pack('V', 4 + strlen($chunks)).'WEBP'.$chunks;
    }
}
