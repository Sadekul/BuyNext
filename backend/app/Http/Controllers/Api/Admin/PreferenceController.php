<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\AdminPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Phase 7: the signed-in admin's own grid preferences (visible columns,
 * page size, sort, saved filters) for the products, orders, and customers
 * grids. No permission key: an admin only ever reads and writes their own.
 */
class PreferenceController extends Controller
{
    private const MAX_BYTES = 16384;

    /** GET /api/admin/v1/preferences/{key} → { key, value | null, updated_at | null } */
    public function show(Request $request, string $key): JsonResponse
    {
        if (! in_array($key, AdminPreference::KEYS, true)) {
            return $this->unknown();
        }

        return $this->answer($key, AdminPreference::where('admin_id', $request->user()->id)->where('key', $key)->first());
    }

    /** PUT /api/admin/v1/preferences/{key} { value: { columns?, page_size?, sort?, direction?, filters? } } - replaces the value. */
    public function update(Request $request, string $key): JsonResponse
    {
        if (! in_array($key, AdminPreference::KEYS, true)) {
            return $this->unknown();
        }
        $request->validate([
            'value' => ['present', 'array'],
            'value.columns' => ['sometimes', 'array', 'max:50'],
            'value.columns.*' => ['string', 'max:60', 'distinct'],
            'value.page_size' => ['sometimes', 'integer', 'in:10,20,25,50,100'],
            'value.sort' => ['sometimes', 'nullable', 'string', 'max:60'],
            'value.direction' => ['sometimes', 'nullable', 'in:asc,desc'],
            'value.filters' => ['sometimes', 'array', 'max:20'],
            'value.filters.*.name' => ['required', 'string', 'min:1', 'max:60'],
            'value.filters.*.params' => ['present', 'array'],
        ]);
        $unknown = array_diff(array_keys($request->input('value', [])), ['columns', 'page_size', 'sort', 'direction', 'filters']);
        if ($unknown) {
            throw ValidationException::withMessages(['value' => 'Unknown setting: '.implode(', ', $unknown).'.']);
        }
        // Keep exactly what was sent (params as given), within the size limit.
        $value = $request->input('value');
        if (strlen(json_encode($value)) > self::MAX_BYTES) {
            throw ValidationException::withMessages(['value' => 'These settings are too big to save.']);
        }

        $preference = AdminPreference::updateOrCreate(['admin_id' => $request->user()->id, 'key' => $key], ['value' => $value]);

        return $this->answer($key, $preference);
    }

    private function answer(string $key, ?AdminPreference $preference): JsonResponse
    {
        return response()->json(['data' => [
            'key' => $key,
            'value' => $preference?->value,
            'updated_at' => $preference?->updated_at?->toIso8601ZuluString(),
        ]]);
    }

    private function unknown(): JsonResponse
    {
        return response()->json(['message' => 'Unknown preference.'], 404);
    }
}
