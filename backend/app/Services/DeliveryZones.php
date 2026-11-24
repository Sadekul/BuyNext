<?php

namespace App\Services;

use App\Models\BdArea;
use App\Models\DeliveryZone;
use App\Models\DeliveryZonePlace;
use Illuminate\Support\Collection;

/**
 * Phase 14: which delivery zone a Bangladesh place is in. An area listed in
 * an active zone beats its district listed in an active zone, which beats the
 * active fallback zone. Only structured Bangladesh addresses have a zone.
 * The zones are read once per request (flush() after staff change them).
 */
class DeliveryZones
{
    private ?Collection $zones = null;

    private ?Collection $places = null;

    /** Active and inactive zones by id, in position order. */
    public function all(): Collection
    {
        return $this->zones ??= DeliveryZone::orderBy('position')->orderBy('id')->get()->keyBy('id');
    }

    public function flush(): void
    {
        $this->zones = null;
        $this->places = null;
    }

    public function find(?string $code): ?DeliveryZone
    {
        return $code === null ? null : $this->all()->first(fn (DeliveryZone $zone) => $zone->code === $code);
    }

    /** @return list<string> the codes of every zone */
    public function codes(): array
    {
        return $this->all()->pluck('code')->values()->all();
    }

    public function zoneFor(?int $areaId, ?int $districtId): ?DeliveryZone
    {
        if (! $areaId && ! $districtId) {
            return null;
        }
        $this->places ??= DeliveryZonePlace::get(['zone_id', 'district_id', 'area_id']);
        $active = fn (?DeliveryZonePlace $place) => $place ? $this->all()->get($place->zone_id) : null;

        $byArea = $areaId ? $active($this->places->first(fn ($place) => $place->area_id === $areaId)) : null;
        if ($byArea?->is_active) {
            return $byArea;
        }
        $byDistrict = $districtId ? $active($this->places->first(fn ($place) => $place->district_id === $districtId)) : null;
        if ($byDistrict?->is_active) {
            return $byDistrict;
        }

        return $this->all()->first(fn (DeliveryZone $zone) => $zone->is_fallback && $zone->is_active);
    }

    /** The zone of a (stored or sent) address: only structured Bangladesh addresses have one. */
    public function forAddress(?array $address): ?DeliveryZone
    {
        if (! is_array($address) || ! BdAddresses::isBangladesh($address['country'] ?? null)) {
            return null;
        }
        $area = is_numeric($address['area_id'] ?? null) ? (int) $address['area_id'] : null;
        $district = is_numeric($address['district_id'] ?? null) ? (int) $address['district_id'] : null;
        if ($area && ! $district) {
            $district = BdArea::find($area)?->district_id;
        }

        return $this->zoneFor($area, $district);
    }
}
