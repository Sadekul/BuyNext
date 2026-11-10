<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\AdminRole;
use App\Services\Audit;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Roles (Magento's System → Permissions → User Roles) and the permission list for the role form. */
class RoleController extends Controller
{
    public function __construct(private Audit $audit) {}

    /** GET /api/admin/v1/roles - every role with how many admins use it (not paginated: a shop has a handful). */
    public function index(): JsonResponse
    {
        $roles = AdminRole::withCount('admins')->orderByDesc('is_system')->orderBy('name')->get();

        return response()->json(['data' => $roles->map(fn (AdminRole $role) => $this->resource($role))]);
    }

    /** POST /api/admin/v1/roles { name, description?, permissions: [keys] } → 201 */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->rules(null), $this->messages());

        $role = DB::transaction(function () use ($data) {
            $role = AdminRole::create(['name' => trim($data['name']), 'description' => $data['description'] ?? null,
                'permissions' => $this->ordered($data['permissions'])]);
            $this->audit->record('role.created', "Role {$role->name} created.", 'role', $role->id,
                Audit::created(['name' => $role->name, 'description' => $role->description, 'permissions' => $role->permissions]));

            return $role;
        });

        return response()->json(['data' => $this->resource($role->loadCount('admins'))], 201);
    }

    /** PATCH /api/admin/v1/roles/{id} { name?, description?, permissions? } - system roles: 422. */
    public function update(Request $request, int $id): JsonResponse
    {
        $role = AdminRole::find($id);
        if (! $role) {
            return $this->notFound();
        }
        if ($role->is_system) {
            throw ValidationException::withMessages(['role' => "The {$role->name} role is built in and can't be changed."]);
        }
        $data = $request->validate($this->rules($role), $this->messages());

        DB::transaction(function () use ($role, $data) {
            $before = ['name' => $role->name, 'description' => $role->description, 'permissions' => $role->permissions];
            if (isset($data['name'])) {
                $role->name = trim($data['name']);
            }
            if (array_key_exists('description', $data)) {
                $role->description = $data['description'];
            }
            if (isset($data['permissions'])) {
                $role->permissions = $this->ordered($data['permissions']);
            }
            $role->save();
            $changes = Audit::diff($before, ['name' => $role->name, 'description' => $role->description, 'permissions' => $role->permissions]);
            if ($changes) {
                $this->audit->record('role.updated', "Role {$role->name} updated.", 'role', $role->id, $changes);
            }
        });

        return response()->json(['data' => $this->resource($role->loadCount('admins'))]);
    }

    /** DELETE /api/admin/v1/roles/{id} → 204. System roles and roles in use: 422. */
    public function destroy(int $id): JsonResponse
    {
        $role = AdminRole::find($id);
        if (! $role) {
            return $this->notFound();
        }
        if ($role->is_system) {
            throw ValidationException::withMessages(['role' => "The {$role->name} role is built in and can't be deleted."]);
        }

        DB::transaction(function () use ($role) {
            $count = $role->admins()->lockForUpdate()->count();
            if ($count > 0) {
                throw ValidationException::withMessages(['role' => $count === 1
                    ? '1 admin has this role. Give them another role first.'
                    : "{$count} admins have this role. Give them another role first."]);
            }
            $this->audit->record('role.deleted', "Role {$role->name} deleted.", 'role', $role->id,
                Audit::deleted(['name' => $role->name, 'description' => $role->description, 'permissions' => $role->permissions]));
            $role->delete();
        });

        return response()->json(null, 204);
    }

    /** GET /api/admin/v1/permissions → [{ group, label, permissions: [{ key, label }] }] */
    public function permissions(): JsonResponse
    {
        return response()->json(['data' => Permissions::catalog()]);
    }

    private function rules(?AdminRole $role): array
    {
        $required = $role ? 'sometimes' : 'required';

        return [
            'name' => [$required, 'string', 'min:2', 'max:60', Rule::unique('admin_roles', 'name')->ignore($role?->id)],
            'description' => ['nullable', 'string', 'max:255'],
            'permissions' => [$required, 'array'],
            'permissions.*' => ['string', 'distinct', Rule::in(Permissions::all())],
        ];
    }

    private function messages(): array
    {
        return [
            'name.unique' => 'There is already a role with this name.',
            'permissions.*.in' => 'Unknown permission.',
        ];
    }

    /** Stored in catalog order, so the list reads the same however the form sent it. */
    private function ordered(array $keys): array
    {
        return array_values(array_filter(Permissions::all(), fn ($key) => in_array($key, $keys, true)));
    }

    private function resource(AdminRole $role): array
    {
        return [
            'id' => $role->id,
            'name' => $role->name,
            'description' => $role->description,
            'permissions' => $role->permissionKeys(),
            'is_system' => (bool) $role->is_system,
            'admins_count' => $role->admins_count ?? $role->admins()->count(),
            'created_at' => $role->created_at?->toIso8601ZuluString(),
            'updated_at' => $role->updated_at?->toIso8601ZuluString(),
        ];
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Role not found.'], 404);
    }
}
