<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Phase 14: the three delivery zones Bangladeshi shops use and their places
 * (no prices: those are shipping table rates staff set). Idempotent: only
 * missing zones and places are added; staff edits are kept.
 *
 * Inside Dhaka = the metro thanas of Dhaka North and South city corporations;
 * Dhaka suburbs = Dhaka district (the rest of it), Gazipur, Narayanganj;
 * Outside Dhaka = the fallback for every other place.
 */
class DeliveryZonesSeeder extends Seeder
{
    public const DHAKA_DISTRICT = 47;

    public const SUBURB_DISTRICTS = [47, 41, 43]; // Dhaka, Gazipur, Narayanganj

    public function run(): void
    {
        $now = now();
        $zones = [
            ['code' => 'inside_dhaka', 'name' => 'Inside Dhaka', 'bn_name' => 'ঢাকার ভেতরে', 'position' => 1, 'is_fallback' => false],
            ['code' => 'dhaka_suburbs', 'name' => 'Dhaka suburbs', 'bn_name' => 'ঢাকার আশপাশ', 'position' => 2, 'is_fallback' => false],
            ['code' => 'outside_dhaka', 'name' => 'Outside Dhaka', 'bn_name' => 'ঢাকার বাইরে', 'position' => 3, 'is_fallback' => true],
        ];
        $hasFallback = DB::table('delivery_zones')->where('is_fallback', true)->exists();
        foreach ($zones as $zone) {
            if (! DB::table('delivery_zones')->where('code', $zone['code'])->exists()) {
                DB::table('delivery_zones')->insert([...$zone, 'is_fallback' => $zone['is_fallback'] && ! $hasFallback, 'is_active' => true,
                    'created_at' => $now, 'updated_at' => $now]);
            }
        }
        $ids = DB::table('delivery_zones')->pluck('id', 'code');

        $dhakaThanas = DB::table('bd_areas')->where('district_id', self::DHAKA_DISTRICT)->where('kind', 'thana')
            ->where('city_corporation', 'like', 'Dhaka%')->pluck('id');
        foreach ($dhakaThanas as $areaId) {
            if (! DB::table('delivery_zone_places')->where('area_id', $areaId)->exists()) {
                DB::table('delivery_zone_places')->insert(['zone_id' => $ids['inside_dhaka'], 'area_id' => $areaId, 'created_at' => $now, 'updated_at' => $now]);
            }
        }
        foreach (self::SUBURB_DISTRICTS as $districtId) {
            if (! DB::table('delivery_zone_places')->where('district_id', $districtId)->exists()) {
                DB::table('delivery_zone_places')->insert(['zone_id' => $ids['dhaka_suburbs'], 'district_id' => $districtId, 'created_at' => $now, 'updated_at' => $now]);
            }
        }
    }
}
