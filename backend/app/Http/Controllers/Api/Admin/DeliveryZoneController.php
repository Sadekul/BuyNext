<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\BdArea;
use App\Models\BdDistrict;
use App\Models\DeliveryZone;
use App\Models\DeliveryZonePlace;
use App\Models\ShippingRate;
use App\Services\Audit;
use App\Services\DeliveryZones;
use App\Services\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Phase 14: Settings → Shipping → Delivery zones (Bangladesh). A zone holds
 * districts and areas (an area beats its district; the fallback zone takes
 * every other place); prices are shipping table rates with its code.
 * Reading needs settings.view, changing settings.edit.
 */
class DeliveryZoneController extends Controller
{
    public function __construct(private Audit $audit, private DeliveryZones $zones) {}

    /** GET /api/admin/v1/delivery-zones → { data: [Zone] } in position order. */
    public function index(): JsonResponse
    {
        $zones = DeliveryZone::with('places')->orderBy('position')->orderBy('id')->get();

        return response()->json(['data' => $zones->map(fn (DeliveryZone $zone) => $this->toApi($zone))->values()]);
    }

    /** GET /api/admin/v1/delivery-zones/match?area_id=&district_id= → { data: Zone | null } */
    public function match(Request $request): JsonResponse
    {
        $data = $request->validate([
            'area_id' => ['nullable', 'integer', 'min:1', 'required_without:district_id'],
            'district_id' => ['nullable', 'integer', 'min:1'],
        ]);
        $district = $data['district_id'] ?? (isset($data['area_id']) ? BdArea::find($data['area_id'])?->district_id : null);
        $zone = $this->zones->zoneFor($data['area_id'] ?? null, $district);

        return response()->json(['data' => $zone ? $this->toApi($zone->load('places')) : null]);
    }

    /** POST /api/admin/v1/delivery-zones → 201 { data: Zone } */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request, null);
        $zone = DB::transaction(function () use ($data) {
            $zone = DeliveryZone::create([
                'code' => $data['code'], 'name' => $data['name'], 'bn_name' => $data['bn_name'],
                'position' => $data['position'] ?? ((int) DeliveryZone::max('position') + 1),
                'is_active' => $data['is_active'] ?? true, 'is_fallback' => $data['is_fallback'] ?? false,
            ]);
            $this->savePlaces($zone, $data);
            $this->audit->record('delivery_zone.created', "Delivery zone {$zone->code} created.", 'delivery_zone', $zone->id,
                ['before' => [], 'after' => $this->auditFields($zone)]);

            return $zone;
        });

        return response()->json(['data' => $this->toApi($zone->fresh('places'))], 201);
    }

    /** PATCH /api/admin/v1/delivery-zones/{id} (only what's sent; district_ids / area_ids replace the zone's places) */
    public function update(Request $request, int $id): JsonResponse
    {
        $zone = DeliveryZone::with('places')->find($id);
        if (! $zone) {
            return $this->notFound();
        }
        $data = $this->validated($request, $zone);
        DB::transaction(function () use ($zone, $data) {
            $before = $this->auditFields($zone);
            $oldCode = $zone->code;
            $zone->fill(array_intersect_key($data, array_flip(['code', 'name', 'bn_name', 'position', 'is_active', 'is_fallback'])))->save();
            if ($oldCode !== $zone->code) {
                // The zone's rates, the COD zones setting and its orders' filter follow the new code.
                ShippingRate::where('zone_code', $oldCode)->update(['zone_code' => $zone->code]);
                $settings = app(Settings::class);
                $codZones = (array) $settings->get('cod_zones', []);
                if (in_array($oldCode, $codZones, true)) {
                    $settings->put(['cod_zones' => array_values(array_map(fn ($code) => $code === $oldCode ? $zone->code : $code, $codZones))]);
                }
            }
            $this->savePlaces($zone, $data);
            if ($diff = Audit::diff($before, $this->auditFields($zone->fresh('places')))) {
                $this->audit->record('delivery_zone.updated', "Delivery zone {$zone->code} updated.", 'delivery_zone', $zone->id, $diff);
            }
        });

        return response()->json(['data' => $this->toApi($zone->fresh('places'))]);
    }

    /** DELETE /api/admin/v1/delivery-zones/{id} → 204; refused for the fallback zone and a zone in use (rates, COD zones). */
    public function destroy(int $id): Response|JsonResponse
    {
        $zone = DeliveryZone::with('places')->find($id);
        if (! $zone) {
            return $this->notFound();
        }
        $problem = match (true) {
            $zone->is_fallback => 'This is the fallback zone for every other place. Make another zone the fallback first.',
            ShippingRate::where('zone_code', $zone->code)->exists() => 'Shipping rates use this zone. Delete or change those rates first.',
            in_array($zone->code, (array) app(Settings::class)->get('cod_zones', []), true) => 'Cash on delivery is limited to this zone (Settings → Payment methods). Remove it there first.',
            default => null,
        };
        if ($problem) {
            throw ValidationException::withMessages(['zone' => $problem]);
        }
        DB::transaction(function () use ($zone) {
            $before = $this->auditFields($zone);
            $zone->delete();
            $this->audit->record('delivery_zone.deleted', "Delivery zone {$zone->code} deleted.", 'delivery_zone', $zone->id, ['before' => $before, 'after' => []]);
        });

        return response()->noContent();
    }

    private function validated(Request $request, ?DeliveryZone $zone): array
    {
        $need = $zone ? ['sometimes', 'required'] : ['required'];
        $data = $request->validate([
            'code' => [...$need, 'string', 'regex:/^[a-z0-9_]{2,40}$/', Rule::unique('delivery_zones', 'code')->ignore($zone?->id)],
            'name' => [...$need, 'string', 'max:80'],
            'bn_name' => [...$need, 'string', 'max:80'],
            'position' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100000'],
            'is_active' => ['sometimes', 'boolean'],
            'is_fallback' => ['sometimes', 'boolean'],
            'district_ids' => ['sometimes', 'array', 'max:64'],
            'district_ids.*' => ['integer', 'distinct', Rule::exists('bd_districts', 'id')],
            'area_ids' => ['sometimes', 'array', 'max:600'],
            'area_ids.*' => ['integer', 'distinct', Rule::exists('bd_areas', 'id')],
        ], [
            'code.regex' => 'Use 2–40 lowercase letters, digits and _ (for example inside_dhaka).',
            'code.unique' => 'Another zone has this code.',
            'district_ids.*.exists' => 'This district doesn\'t exist.',
            'area_ids.*.exists' => 'This area doesn\'t exist.',
        ]);

        // A place belongs to at most one zone.
        $errors = [];
        foreach (['district_ids' => 'district_id', 'area_ids' => 'area_id'] as $key => $column) {
            foreach ($data[$key] ?? [] as $index => $placeId) {
                $taken = DeliveryZonePlace::with('zone')->where($column, $placeId)->when($zone, fn ($q) => $q->where('zone_id', '!=', $zone->id))->first();
                if ($taken) {
                    $name = $column === 'district_id' ? BdDistrict::find($placeId)?->name : BdArea::find($placeId)?->name;
                    $errors["{$key}.{$index}"] = "{$name} is already in zone {$taken->zone->name}.";
                }
            }
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        return $data;
    }

    private function savePlaces(DeliveryZone $zone, array $data): void
    {
        if (($data['is_fallback'] ?? false) === true) {
            DeliveryZone::whereKeyNot($zone->id)->where('is_fallback', true)->update(['is_fallback' => false]);
        }
        foreach (['district_ids' => 'district_id', 'area_ids' => 'area_id'] as $key => $column) {
            if (! array_key_exists($key, $data)) {
                continue;
            }
            $zone->places()->whereNotNull($column)->delete();
            foreach (array_unique($data[$key]) as $placeId) {
                $zone->places()->create([$column => (int) $placeId]);
            }
        }
        $zone->unsetRelation('places');
        $this->zones->flush();
    }

    private function auditFields(DeliveryZone $zone): array
    {
        $zone->loadMissing('places');

        return [
            ...$zone->only(['code', 'name', 'bn_name', 'position', 'is_active', 'is_fallback']),
            'district_ids' => $zone->places->whereNotNull('district_id')->pluck('district_id')->sort()->values()->all(),
            'area_ids' => $zone->places->whereNotNull('area_id')->pluck('area_id')->sort()->values()->all(),
        ];
    }

    /** { id, code, name, bn_name, position, is_active, is_fallback, districts, areas, rates_count } */
    private function toApi(DeliveryZone $zone): array
    {
        $districtIds = $zone->places->whereNotNull('district_id')->pluck('district_id');
        $areaIds = $zone->places->whereNotNull('area_id')->pluck('area_id');
        $areas = BdArea::with('district')->whereIn('id', $areaIds)->orderBy('name')->get();

        return [
            'id' => $zone->id,
            'code' => $zone->code,
            'name' => $zone->name,
            'bn_name' => $zone->bn_name,
            'position' => $zone->position,
            'is_active' => $zone->is_active,
            'is_fallback' => $zone->is_fallback,
            'districts' => BdDistrict::whereIn('id', $districtIds)->orderBy('name')->get()
                ->map(fn (BdDistrict $district) => ['id' => $district->id, 'name' => $district->name, 'bn_name' => $district->bn_name])->values(),
            'areas' => $areas->map(fn (BdArea $area) => ['id' => $area->id, 'name' => $area->name, 'bn_name' => $area->bn_name,
                'district_id' => $area->district_id, 'district_name' => $area->district?->name])->values(),
            'rates_count' => ShippingRate::where('zone_code', $zone->code)->count(),
        ];
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Delivery zone not found.'], 404);
    }
}
