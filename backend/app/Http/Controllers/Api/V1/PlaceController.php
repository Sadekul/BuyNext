<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\BdArea;
use App\Models\BdDistrict;
use App\Models\BdDivision;
use App\Support\Locale;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;

/**
 * Phase 14: Bangladesh places for the address form (division → district →
 * area). Public; the answers rarely change, so they are cached on the server
 * (per language) and by browsers (a day). `name` is in the request's language,
 * and lists are sorted by it.
 */
class PlaceController extends Controller
{
    /** Bumped when the places change (BangladeshPlacesSeeder fixes), so cached answers are dropped. */
    private const CACHE_VERSION = 2; // 2: the Dhaka Metropolitan Police thanas were added

    /** GET /api/v1/places/bd/divisions */
    public function divisions(): JsonResponse
    {
        return $this->answer('divisions', fn () => BdDivision::all()->map(fn (BdDivision $division) => [
            'id' => $division->id, ...$this->names($division),
        ]));
    }

    /** GET /api/v1/places/bd/districts?division= (all 64 without it) */
    public function districts(Request $request): JsonResponse
    {
        $data = $request->validate(['division' => ['nullable', 'integer', 'min:1']]);
        $division = $data['division'] ?? null;

        return $this->answer('districts:'.($division ?? 'all'), fn () => BdDistrict::query()
            ->when($division, fn ($query) => $query->where('division_id', $division))->get()
            ->map(fn (BdDistrict $district) => ['id' => $district->id, 'division_id' => $district->division_id, ...$this->names($district)]));
    }

    /** GET /api/v1/places/bd/areas?district= (required) */
    public function areas(Request $request): JsonResponse
    {
        $data = $request->validate(['district' => ['required', 'integer', 'min:1']], [
            'district.required' => __('Choose your district.'),
        ]);

        return $this->answer("areas:{$data['district']}", fn () => BdArea::where('district_id', $data['district'])->get()
            ->map(fn (BdArea $area) => [
                'id' => $area->id,
                'district_id' => $area->district_id,
                ...$this->names($area),
                'kind' => $area->kind,
                'city_corporation' => $area->city_corporation,
                'postcodes' => array_values($area->postcodes ?? []),
            ]));
    }

    private function names(BdDivision|BdDistrict|BdArea $place): array
    {
        return ['name' => $place->localName(), 'name_en' => $place->name, 'name_bn' => $place->bn_name];
    }

    /** { data: [...] } sorted by name in the request's language, cached per language. */
    private function answer(string $key, callable $rows): JsonResponse
    {
        $locale = Locale::current();
        $data = Cache::remember('buynest.places.v'.self::CACHE_VERSION.":{$locale}:{$key}", now()->addDay(), function () use ($rows, $locale) {
            /** @var Collection $list */
            $list = $rows();
            $collator = class_exists(\Collator::class) ? new \Collator($locale === 'bn' ? 'bn_BD' : 'en_US') : null;

            return $list->sort(fn (array $a, array $b) => $collator ? $collator->compare($a['name'], $b['name']) : strcmp($a['name'], $b['name']))
                ->values()->all();
        });

        return response()->json(['data' => $data])->withHeaders([
            'Cache-Control' => 'public, max-age=86400',
            'Vary' => 'Accept-Language',
        ]);
    }
}
