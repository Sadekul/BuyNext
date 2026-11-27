<?php

namespace App\Services\Sms;

/**
 * Phase 20: how long a text is in SMS terms. A text written only with the
 * GSM-7 alphabet fits 160 characters in one SMS (153 per part when split);
 * anything else (any Bangla letter, "৳", emoji) makes the whole text Unicode:
 * 70 characters in one SMS, 67 per part. The extension characters (€ [ ] { } …)
 * take two GSM places. Providers bill per part, so the admin shows this live.
 */
class SmsText
{
    /** The GSM 03.38 basic alphabet. */
    private const GSM_BASIC = "@£\$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

    /** The GSM 03.38 extension table (each takes two places). */
    private const GSM_EXTENDED = "^{}\\[~]|€\f";

    /** @return array{encoding: string, segments: int, length: int} length: characters (GSM places for GSM-7) */
    public static function measure(string $body): array
    {
        $chars = mb_str_split($body);
        $length = 0;
        $gsm = true;
        foreach ($chars as $char) {
            if (mb_strpos(self::GSM_BASIC, $char) !== false) {
                $length++;
            } elseif (mb_strpos(self::GSM_EXTENDED, $char) !== false) {
                $length += 2;
            } else {
                $gsm = false;
                break;
            }
        }

        if ($gsm) {
            return ['encoding' => 'gsm', 'segments' => self::segments($length, 160, 153), 'length' => $length];
        }
        // UTF-16 code units: Bangla is one each, an emoji two.
        $units = intdiv(strlen((string) mb_convert_encoding($body, 'UTF-16BE', 'UTF-8')), 2);

        return ['encoding' => 'unicode', 'segments' => self::segments($units, 70, 67), 'length' => $units];
    }

    private static function segments(int $length, int $single, int $part): int
    {
        return $length <= $single ? 1 : (int) ceil($length / $part);
    }
}
