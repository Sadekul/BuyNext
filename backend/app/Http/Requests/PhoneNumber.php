<?php

namespace App\Http\Requests;

/** Phone numbers in international (E.164) form: "+15550100100". */
final class PhoneNumber
{
    public const RULE = 'regex:/^\+[1-9]\d{6,14}$/';

    /** "+1 (555) 010-0100" → "+15550100100"; "00880…" → "+880…". */
    public static function normalize(string $phone): string
    {
        $phone = preg_replace('/[\s().-]/', '', trim($phone));

        return str_starts_with($phone, '00') ? '+'.substr($phone, 2) : $phone;
    }
}
