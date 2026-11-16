<?php

namespace App\Support;

use Illuminate\Http\Response;

/**
 * CSV downloads. A cell starting with = + - @ (or a tab / carriage return)
 * could run as a formula when opened in a spreadsheet ("CSV injection"), so it
 * gets a ' in front. Plain numbers such as -5.00 are left alone: they can't be
 * formulas, and a refund total must stay a number.
 */
final class Csv
{
    public static function download(string $filename, array $header, iterable $rows): Response
    {
        $stream = fopen('php://temp', 'r+');
        fputcsv($stream, $header, escape: '');
        foreach ($rows as $row) {
            fputcsv($stream, array_map(self::safeCell(...), $row), escape: '');
        }
        rewind($stream);
        $body = stream_get_contents($stream);
        fclose($stream);

        return response($body, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ]);
    }

    public static function safeCell(mixed $value): string
    {
        $value = (string) $value;
        if (preg_match('/^-?\d+(\.\d+)?$/', $value)) {
            return $value;
        }

        return preg_match('/^[=+\-@\t\r]/', $value) ? "'".$value : $value;
    }
}
