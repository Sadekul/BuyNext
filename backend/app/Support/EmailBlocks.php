<?php

namespace App\Support;

use App\Services\BdAddresses;

/**
 * Phase 7: the prebuilt HTML pieces ("block" variables) email templates can
 * use: an items table, an address, a button, a tracking box, a staff note.
 * Built here, in code, with every value escaped, so a template can insert
 * them as they are. Inline styles, because many mail apps ignore <style>.
 */
final class EmailBlocks
{
    private const CELL = 'padding:6px 0;border-bottom:1px solid #e7e5e4';

    /**
     * $rows: [[label, amount], ...] (one per item); $totals: [[label, amount, bold?], ...] under them.
     */
    public static function itemsTable(array $rows, array $totals = []): string
    {
        $html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:14px">';
        foreach ($rows as [$label, $amount]) {
            $html .= '<tr><td style="'.self::CELL.'">'.e($label).'</td><td style="'.self::CELL.';text-align:right">'.e($amount).'</td></tr>';
        }
        foreach ($totals as $total) {
            $weight = ($total[2] ?? false) ? 'padding:8px 0;font-weight:bold' : 'padding:6px 0';
            $html .= '<tr><td style="'.$weight.'">'.e($total[0]).'</td><td style="'.$weight.';text-align:right">'.e($total[1]).'</td></tr>';
        }

        return $html.'</table>';
    }

    /** A bulleted list (returned items). */
    public static function list(array $lines): string
    {
        return '<ul style="margin:0 0 16px;padding-left:20px">'.implode('', array_map(fn ($line) => '<li>'.e($line).'</li>', $lines)).'</ul>';
    }

    /** An order address (first_name, last_name, line1, line2, city, state, postal_code, country). */
    public static function address(?array $address): string
    {
        if (! $address) {
            return '';
        }
        // Phase 14: a structured Bangladesh address: house/road, area and district, division and postcode (place names in the email's language).
        $bangladesh = BdAddresses::lines($address, Locale::current());
        if ($bangladesh !== null) {
            $lines = [trim(($address['first_name'] ?? '').' '.($address['last_name'] ?? '')), ...$bangladesh];
        } else {
            $line1 = $address['line1'].(filled($address['line2'] ?? null) ? ', '.$address['line2'] : '');
            $city = $address['city'].(filled($address['state'] ?? null) ? ', '.$address['state'] : '').' '.$address['postal_code'];
            $lines = [trim($address['first_name'].' '.$address['last_name']), $line1, $city, $address['country']];
        }

        return '<p style="margin:0 0 16px;font-size:14px;line-height:1.5">'.implode('<br>', array_map(fn ($line) => e($line), $lines)).'</p>';
    }

    /** A link styled as a button; empty without a URL. Only http(s) links. */
    public static function button(?string $url, string $label): string
    {
        if (! $url || ! preg_match('#^https?://#i', $url)) {
            return '';
        }

        return '<p style="margin:0 0 16px"><a href="'.e($url).'" style="display:inline-block;padding:10px 18px;background:#4338ca;'
            .'color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold">'.e($label).'</a></p>';
    }

    /** "Carrier: UPS / Tracking number: …" in a highlighted box. */
    public static function tracking(string $carrier, ?string $trackingNumber): string
    {
        // Phase 13: labels in the email's language.
        $html = e(__('Carrier')).': <strong>'.e($carrier).'</strong>';
        if (filled($trackingNumber)) {
            $html .= '<br>'.e(__('Tracking number')).': <strong>'.e($trackingNumber).'</strong>';
        }

        return self::box($html);
    }

    /** "A note from {store}: …", or nothing without a note. */
    public static function note(?string $note, string $storeName = 'BuyNest'): string
    {
        return filled($note) ? '<p style="margin:0 0 16px;font-size:14px">'.e(__('A note from :store', ['store' => $storeName])).': '.e($note).'</p>' : '';
    }

    /** A plain paragraph, or nothing for an empty text. */
    public static function paragraph(?string $text): string
    {
        return filled($text) ? '<p style="margin:0 0 16px">'.e($text).'</p>' : '';
    }

    /** $html must already be escaped. */
    private static function box(string $html): string
    {
        return '<p style="margin:0 0 16px;padding:12px 16px;background:#eef2ff;border-radius:8px">'.$html.'</p>';
    }
}
