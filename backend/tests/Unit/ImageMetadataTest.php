<?php

namespace Tests\Unit;

use App\Support\ImageMetadata;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;
use Tests\Support\TestImages;

/** Phase 22: the pure-PHP cleaner removes hidden data (GPS, camera, comments) and keeps the pixels. */
class ImageMetadataTest extends TestCase
{
    public function test_a_jpeg_loses_exif_comments_and_iptc_but_keeps_jfif_icc_and_the_image(): void
    {
        $icc = "ICC_PROFILE\0\x01\x01".str_repeat('c', 20);
        $iptc = "Photoshop 3.0\0".TestImages::GPS_TEXT;
        $original = TestImages::jpegWithGps(40, 30);
        // Add an ICC profile (APP2, kept) and an IPTC block (APP13, dropped) after the EXIF segment.
        $original = substr($original, 0, 2)."\xFF\xE2".pack('n', strlen($icc) + 2).$icc."\xFF\xED".pack('n', strlen($iptc) + 2).$iptc.substr($original, 2);
        $this->assertStringContainsString('Exif', $original);
        $this->assertStringContainsString('GPS', $original);

        $clean = ImageMetadata::strip($original, 'jpg');

        $this->assertStringNotContainsString('Exif', $clean);
        $this->assertStringNotContainsString('GPS', $clean);
        $this->assertStringNotContainsString('Photoshop', $clean);
        $this->assertStringContainsString('JFIF', $clean);
        $this->assertStringContainsString('ICC_PROFILE', $clean);
        $this->assertSame("\xFF\xD8", substr($clean, 0, 2));
        $this->assertSame("\xFF\xD9", substr($clean, -2));
        // The image data (from the first scan on) is copied byte for byte.
        $this->assertSame(substr($original, strpos($original, "\xFF\xDA")), substr($clean, strpos($clean, "\xFF\xDA")));
        $this->assertSame([40, 30], array_slice(getimagesizefromstring($clean), 0, 2));
        // Cleaning twice changes nothing more.
        $this->assertSame($clean, ImageMetadata::strip($clean, 'jpg'));
    }

    public function test_a_png_loses_its_text_exif_and_time_chunks(): void
    {
        $original = TestImages::pngWithText(40, 30);
        $this->assertStringContainsString('GPS', $original);

        $clean = ImageMetadata::strip($original, 'png');

        $this->assertStringNotContainsString('GPS', $clean);
        foreach (['tEXt', 'eXIf', 'iTXt', 'tIME', 'zTXt'] as $chunk) {
            $this->assertStringNotContainsString($chunk, $clean);
        }
        $this->assertSame(TestImages::png(40, 30), $clean); // exactly the PNG before the chunks were added
        $this->assertSame([40, 30], array_slice(getimagesizefromstring($clean), 0, 2));
    }

    public function test_a_png_ztxt_chunk_is_dropped_too(): void
    {
        $png = TestImages::png(4, 4);
        $with = substr($png, 0, 33).TestImages::pngChunk('zTXt', "Comment\0\0".gzcompress(TestImages::GPS_TEXT)).substr($png, 33);

        $this->assertSame($png, ImageMetadata::strip($with, 'png'));
    }

    public function test_a_webp_loses_exif_and_xmp_chunks_and_flags_and_the_riff_size_is_fixed(): void
    {
        $original = TestImages::webpWithMetadata(40, 30);
        $this->assertStringContainsString('EXIF', $original);
        $this->assertStringContainsString('GPS', $original);

        $clean = ImageMetadata::strip($original, 'webp');

        $this->assertStringNotContainsString('GPS', $clean);
        $this->assertStringNotContainsString('EXIF', $clean);
        $this->assertStringNotContainsString('XMP ', $clean);
        $this->assertSame(strlen($clean) - 8, unpack('V', $clean, 4)[1]);
        $vp8x = strpos($clean, 'VP8X');
        $this->assertSame(0, ord($clean[$vp8x + 8]) & 0x0C, 'The EXIF and XMP flags are cleared.');
        $this->assertSame([40, 30], array_slice(getimagesizefromstring($clean), 0, 2));
        if (function_exists('imagecreatefromstring')) {
            $this->assertNotFalse(@imagecreatefromstring($clean), 'The cleaned WebP still decodes.');
        }
    }

    public function test_clean_files_are_left_as_they_are(): void
    {
        foreach (['png' => TestImages::png(), 'webp' => TestImages::webp()] as $ext => $bytes) {
            $this->assertSame($bytes, ImageMetadata::strip($bytes, $ext), $ext);
        }
        // GD's JPEGs carry a "CREATOR: gd-jpeg" comment: only that goes.
        $jpeg = TestImages::jpeg();
        $this->assertStringContainsString('CREATOR', $jpeg);
        $clean = ImageMetadata::strip($jpeg, 'jpg');
        $this->assertStringNotContainsString('CREATOR', $clean);
        $comment = strpos($jpeg, "\xFF\xFE");
        $length = unpack('n', $jpeg, $comment + 2)[1];
        $this->assertSame(substr($jpeg, 0, $comment).substr($jpeg, $comment + 2 + $length), $clean);
    }

    public function test_broken_files_throw(): void
    {
        $cases = [
            ['jpg', 'not a jpeg'],
            ['jpg', "\xFF\xD8\xFF\xE1\x40\x00Exif"], // a segment longer than the file
            ['jpg', substr(TestImages::jpeg(), 0, 20)], // no image data
            ['png', 'not a png'],
            ['png', substr(TestImages::png(), 0, 40)], // no IEND
            ['webp', 'RIFF....WEBX'],
            ['webp', 'RIFF'.pack('V', 4).'WEBP'], // no chunks
            ['gif', 'GIF89a'],
        ];
        foreach ($cases as [$ext, $bytes]) {
            try {
                ImageMetadata::strip($bytes, $ext);
                $this->fail("No exception for {$ext}: ".bin2hex(substr($bytes, 0, 12)));
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }
}
