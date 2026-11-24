<?php

namespace Tests\Feature\Concerns;

use App\Models\BdArea;
use App\Models\ShippingRate;

/** Phase 14: structured Bangladesh addresses and zone rates for tests (places come from the migration's seeder). */
trait BangladeshAddresses
{
    /** Dhanmondi thana (Dhaka South) → Inside Dhaka. */
    protected function dhanmondi(): BdArea
    {
        return BdArea::where('name', 'Dhanmondi')->where('kind', 'thana')->firstOrFail();
    }

    /** Savar upazila (Dhaka district) → Dhaka suburbs. */
    protected function savar(): BdArea
    {
        return BdArea::where('name', 'Savar')->firstOrFail();
    }

    /** Debidwar upazila (Cumilla) → Outside Dhaka. */
    protected function debidwar(): BdArea
    {
        return BdArea::where('name', 'Debidwar')->firstOrFail();
    }

    protected function bdAddress(?BdArea $area = null, array $overrides = []): array
    {
        $area ??= $this->dhanmondi();
        $area->loadMissing('district');

        return [
            'first_name' => 'Rahim', 'last_name' => 'Uddin', 'line1' => 'House 12, Road 5', 'line2' => null,
            'country' => 'BD', 'division_id' => $area->district->division_id, 'district_id' => $area->district_id, 'area_id' => $area->id,
            'postal_code' => null, ...$overrides,
        ];
    }

    /** Standard: 60 inside Dhaka (1–2 days), 100 in the suburbs (2–3 days), 120 outside (3–5 days). */
    protected function zoneRates(): void
    {
        foreach ([['inside_dhaka', '60.00', 1, 2], ['dhaka_suburbs', '100.00', 2, 3], ['outside_dhaka', '120.00', 3, 5]] as $i => [$zone, $price, $min, $max]) {
            ShippingRate::create(['method' => 'standard', 'country' => '*', 'zone_code' => $zone, 'price' => $price, 'eta_days_min' => $min,
                'eta_days_max' => $max, 'position' => $i, 'min_weight_grams' => 0, 'min_subtotal' => 0]);
        }
        ShippingRate::create(['method' => 'standard', 'country' => '*', 'price' => '9.00', 'position' => 9, 'min_weight_grams' => 0, 'min_subtotal' => 0]);
    }
}
