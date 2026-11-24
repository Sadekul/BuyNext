<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Phase 14: Bangladesh divisions, districts, upazilas and metro thanas from
 * database/data/bd-geo (nuhil/bangladesh-geocode, MIT). Idempotent: rows are
 * upserted by id, so running it again changes nothing (or applies fixes).
 *
 * Upazilas keep the dataset's ids (1–495) and Bangla names. Metro thanas
 * (post offices with link_method "metro_thana") have no row of their own in
 * the dataset: each distinct thana per district becomes an area with an id
 * from 1001 up, in the order it first appears in postcodes.json. Their Bangla
 * names are written by BuyNest (THANA_BN, listed in docs/BANGLADESH.md for
 * review by a Bangla speaker).
 */
class BangladeshPlacesSeeder extends Seeder
{
    public const THANA_ID_BASE = 1000;

    /** English thana name (as in the dataset, any case) → [display name, Bangla name]. */
    public const THANA_NAMES = [
        'palton' => ['Palton', 'পল্টন'],
        'sutrapur' => ['Sutrapur', 'সূত্রাপুর'],
        'new market' => ['New Market', 'নিউ মার্কেট'],
        'mohammadpur' => ['Mohammadpur', 'মোহাম্মদপুর'],
        'dhanmondi' => ['Dhanmondi', 'ধানমন্ডি'],
        'lalbag' => ['Lalbag', 'লালবাগ'],
        'gulshan' => ['Gulshan', 'গুলশান'],
        'sabujbag' => ['Sabujbag', 'সবুজবাগ'],
        'tejgaon' => ['Tejgaon', 'তেজগাঁও'],
        'mirpur' => ['Mirpur', 'মিরপুর'],
        'ramna' => ['Ramna', 'রমনা'],
        'khilgaon' => ['Khilgaon', 'খিলগাঁও'],
        'motijheel' => ['Motijheel', 'মতিঝিল'],
        'khilkhet' => ['Khilkhet', 'খিলক্ষেত'],
        'uttara' => ['Uttara', 'উত্তরা'],
        'jatrabari' => ['Jatrabari', 'যাত্রাবাড়ী'],
        'demra' => ['Demra', 'ডেমরা'],
        'khulna sadar' => ['Khulna Sadar', 'খুলনা সদর'],
    ];

    public function run(): void
    {
        $divisions = self::rows('divisions');
        $districts = self::rows('districts');
        $upazilas = self::rows('upazilas');
        $cityCorporations = collect(self::rows('city_corporations'))->keyBy('id');
        $postcodes = self::rows('postcodes');

        DB::table('bd_divisions')->upsert(array_map(fn ($row) => [
            'id' => (int) $row['id'], 'name' => trim($row['name']), 'bn_name' => trim($row['bn_name']),
        ], $divisions), ['id'], ['name', 'bn_name']);

        DB::table('bd_districts')->upsert(array_map(fn ($row) => [
            'id' => (int) $row['id'], 'division_id' => (int) $row['division_id'], 'name' => trim($row['name']), 'bn_name' => trim($row['bn_name']),
        ], $districts), ['id'], ['division_id', 'name', 'bn_name']);

        // Postcodes of each upazila (post offices linked to it), and the metro thanas.
        $upazilaCodes = [];
        $thanas = [];
        foreach ($postcodes as $row) {
            $code = trim((string) $row['postcode']);
            if (! preg_match('/^\d{4}$/', $code)) {
                continue;
            }
            if ($row['upazila_id'] !== null && $row['upazila_id'] !== '') {
                $upazilaCodes[(int) $row['upazila_id']][$code] = true;
            } elseif (($row['link_method'] ?? null) === 'metro_thana' && filled($row['thana'] ?? null)) {
                $key = $row['district_id'].'|'.mb_strtolower(trim($row['thana']));
                $thanas[$key] ??= [
                    'district_id' => (int) $row['district_id'],
                    'thana' => trim($row['thana']),
                    'city_corporation' => $cityCorporations[$row['city_corporation_id'] ?? '']['name'] ?? null,
                    'codes' => [],
                ];
                $thanas[$key]['codes'][$code] = true;
            }
        }

        $codes = function (array $set): string {
            $list = array_map('strval', array_keys($set));
            sort($list);

            return json_encode($list);
        };
        $areas = array_map(fn ($row) => [
            'id' => (int) $row['id'], 'district_id' => (int) $row['district_id'], 'kind' => 'upazila',
            'name' => trim($row['name']), 'bn_name' => trim($row['bn_name']), 'city_corporation' => null,
            'postcodes' => $codes($upazilaCodes[(int) $row['id']] ?? []),
        ], $upazilas);
        $next = self::THANA_ID_BASE;
        foreach ($thanas as $thana) {
            $names = self::THANA_NAMES[mb_strtolower($thana['thana'])] ?? null;
            if ($names === null) {
                throw new RuntimeException("No Bangla name for the metro thana \"{$thana['thana']}\" (add it to BangladeshPlacesSeeder::THANA_NAMES).");
            }
            $areas[] = [
                'id' => ++$next, 'district_id' => $thana['district_id'], 'kind' => 'thana',
                'name' => $names[0], 'bn_name' => $names[1], 'city_corporation' => $thana['city_corporation'],
                'postcodes' => $codes($thana['codes']),
            ];
        }
        // The Dhaka Metropolitan Police thanas the dataset lacks (Banani, Badda, Wari, …): BuyNest's own
        // list (database/data/bd-geo/dhaka-metro-thanas.json), fixed ids from 1101, no postcodes.
        $extra = json_decode((string) file_get_contents(database_path('data/bd-geo/dhaka-metro-thanas.json')), true, flags: JSON_THROW_ON_ERROR);
        foreach ($extra['thanas'] as $thana) {
            $areas[] = [
                'id' => (int) $thana['id'], 'district_id' => (int) $extra['district_id'], 'kind' => 'thana',
                'name' => $thana['name'], 'bn_name' => $thana['bn_name'], 'city_corporation' => $thana['city_corporation'],
                'postcodes' => $codes([]),
            ];
        }
        foreach (array_chunk($areas, 200) as $chunk) {
            DB::table('bd_areas')->upsert($chunk, ['id'], ['district_id', 'kind', 'name', 'bn_name', 'city_corporation', 'postcodes']);
        }
    }

    /** The table rows of one dataset file (phpMyAdmin JSON export: the entry with "data"). */
    public static function rows(string $file): array
    {
        $path = database_path("data/bd-geo/{$file}.json");
        $json = json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
        foreach ($json as $entry) {
            if (is_array($entry) && isset($entry['data']) && is_array($entry['data'])) {
                return $entry['data'];
            }
        }
        throw new RuntimeException("No rows in {$path}.");
    }
}
