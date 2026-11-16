<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\CustomerGroup;
use App\Services\Audit;
use App\Services\Pricing;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Customer groups (Magento's Customers → Customer groups): a name, a code,
 * and a discount (0–90%) on every line for the group's members. General is
 * the system group: its discount can change, its code can't, and it can't be
 * deleted. A group with customers can't be deleted.
 */
class CustomerGroupController extends Controller
{
    private const FIELDS = ['name', 'code', 'discount_percent'];

    public function __construct(private Audit $audit) {}

    /** GET /api/admin/v1/customer-groups → by name, General first. */
    public function index(): JsonResponse
    {
        $groups = CustomerGroup::withCount('customers')->orderByDesc('is_system')->orderBy('name')->get();

        return response()->json(['data' => $groups->map->toAdminArray()->values()]);
    }

    /** POST /api/admin/v1/customer-groups { name, code?, discount_percent } → 201 */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request, null);
        $group = DB::transaction(function () use ($data) {
            $group = CustomerGroup::create($data);
            $this->audit->record('customer_group.created', "Customer group {$group->name} created ({$group->discount_percent}% off).",
                'customer_group', $group->id, Audit::created(Audit::fieldsOf($group->refresh(), self::FIELDS)));

            return $group;
        });

        return response()->json(['data' => $group->toAdminArray(0)], 201);
    }

    /** PATCH /api/admin/v1/customer-groups/{id} { name?, code?, discount_percent? } */
    public function update(Request $request, int $id): JsonResponse
    {
        $group = CustomerGroup::find($id);
        if (! $group) {
            return $this->notFound();
        }
        $data = $this->validated($request, $group);
        if ($group->is_system && isset($data['code']) && $data['code'] !== $group->code) {
            throw ValidationException::withMessages(['code' => "The {$group->name} group is built in: its code can't change."]);
        }
        DB::transaction(function () use ($group, $data) {
            $before = Audit::fieldsOf($group, self::FIELDS);
            $group->fill($data)->save();
            $diff = Audit::diff($before, Audit::fieldsOf($group->refresh(), self::FIELDS));
            if ($diff) {
                $this->audit->record('customer_group.updated', "Customer group {$group->name} updated: ".implode(', ', array_keys($diff['after'])).'.',
                    'customer_group', $group->id, $diff);
            }
        });

        return response()->json(['data' => $group->toAdminArray()]);
    }

    /** DELETE /api/admin/v1/customer-groups/{id} → 204 */
    public function destroy(int $id): Response|JsonResponse
    {
        $group = CustomerGroup::find($id);
        if (! $group) {
            return $this->notFound();
        }
        if ($group->is_system) {
            throw ValidationException::withMessages(['group' => "The {$group->name} group is built in and can't be deleted."]);
        }
        $count = $group->customers()->count();
        if ($count > 0) {
            throw ValidationException::withMessages(['group' => "{$count} ".Str::plural('customer', $count).' '.($count === 1 ? 'is' : 'are')
                ." in the {$group->name} group. Move ".($count === 1 ? 'them' : 'them all').' to another group first.']);
        }
        DB::transaction(function () use ($group) {
            $before = Audit::fieldsOf($group, self::FIELDS);
            $group->delete();
            $this->audit->record('customer_group.deleted', "Customer group {$group->name} deleted.", 'customer_group', $group->id, Audit::deleted($before));
        });

        return response()->noContent();
    }

    private function validated(Request $request, ?CustomerGroup $group): array
    {
        if (! $group && blank($request->input('code')) && is_string($request->input('name'))) {
            $request->merge(['code' => Str::of($request->input('name'))->lower()->ascii()->replaceMatches('/[^a-z0-9]+/', '_')->trim('_')->limit(40, '')->toString()]);
        } elseif (is_string($request->input('code'))) {
            $request->merge(['code' => mb_strtolower(trim($request->input('code')))]);
        }
        $required = $group ? ['sometimes', 'required'] : ['required'];

        $data = $request->validate([
            'name' => [...$required, 'string', 'max:60', Rule::unique('customer_groups', 'name')->ignore($group?->id)],
            'code' => [...$required, 'string', 'max:40', 'regex:/^[a-z0-9_]+$/', Rule::unique('customer_groups', 'code')->ignore($group?->id)],
            'discount_percent' => [...$required, 'numeric', 'decimal:0,2', 'min:0', 'max:90'],
        ], [
            'name.unique' => 'Another group already has this name.',
            'code.unique' => 'Another group already has this code.',
            'code.regex' => 'The code may only use lower-case letters, digits, and underscores.',
            'discount_percent.max' => 'The discount can be at most 90%.',
        ]);
        if (isset($data['name'])) {
            $data['name'] = trim($data['name']);
        }
        if (isset($data['discount_percent'])) {
            $data['discount_percent'] = Pricing::format(Pricing::toCents((string) $data['discount_percent']));
        }

        return $data;
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Customer group not found.'], 404);
    }
}
