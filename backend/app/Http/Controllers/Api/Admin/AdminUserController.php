<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminResource;
use App\Models\Admin;
use App\Models\AdminRole;
use App\Services\Audit;
use App\Services\TokenPairs;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

/**
 * Admin users (Magento's System → Permissions → All Users). Admins are never
 * deleted, only deactivated, so the audit log and order history keep their names.
 *
 * Rules that keep the shop manageable:
 *   - you can't deactivate or change the role of your own account;
 *   - there is always at least one active Owner;
 *   - only an Owner can give the Owner role or change an Owner's account
 *     (otherwise anyone with admins.manage could make themselves an Owner);
 *   - deactivating or resetting a password signs that admin out everywhere.
 */
class AdminUserController extends Controller
{
    public function __construct(private Audit $audit, private TokenPairs $tokens) {}

    /** GET /api/admin/v1/admins?search&role_id&status=active|inactive&page&per_page */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'role_id' => ['nullable', 'integer'],
            'status' => ['nullable', 'in:active,inactive'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $admins = Admin::with('role')
            ->when($data['search'] ?? null, function ($query, $search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $query->where(fn ($q) => $q->where('name', 'like', $like)->orWhere('email', 'like', $like));
            })
            ->when($data['role_id'] ?? null, fn ($query, $roleId) => $query->where('role_id', $roleId))
            ->when($data['status'] ?? null, fn ($query, $status) => $query->where('is_active', $status === 'active'))
            ->orderBy('name')->orderBy('id')
            ->paginate($data['per_page'] ?? 20)
            ->withQueryString();

        return AdminResource::collection($admins);
    }

    /** GET /api/admin/v1/admins/{id} */
    public function show(int $id): AdminResource|JsonResponse
    {
        $admin = Admin::with('role')->find($id);

        return $admin ? new AdminResource($admin) : $this->notFound();
    }

    /** POST /api/admin/v1/admins { name, email, role_id, password, is_active? } → 201 */
    public function store(Request $request): JsonResponse
    {
        $request->merge(['email' => mb_strtolower(trim((string) $request->input('email')))]);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'string', 'email', 'max:190', 'unique:admins,email'],
            'role_id' => ['required', 'integer', 'exists:admin_roles,id'],
            'password' => ['required', 'string', 'max:128', Password::min(12)->letters()->numbers()],
            'is_active' => ['nullable', 'boolean'],
        ], $this->messages());
        $this->checkOwnerRole($request->user(), (int) $data['role_id']);

        $admin = DB::transaction(function () use ($data) {
            $admin = Admin::create([
                'name' => trim($data['name']),
                'email' => $data['email'],
                'password' => $data['password'],
                'role_id' => $data['role_id'],
            ]);
            $admin->forceFill(['is_active' => $data['is_active'] ?? true])->save();
            $admin->load('role');
            $this->audit->record('admin.created', "Admin {$admin->email} created with the role {$admin->role->name}.", 'admin', $admin->id,
                Audit::created(['name' => $admin->name, 'email' => $admin->email, 'role' => $admin->role->name, 'is_active' => $admin->is_active]));

            return $admin;
        });

        return (new AdminResource($admin))->response()->setStatusCode(201);
    }

    /** PATCH /api/admin/v1/admins/{id} { name?, email?, role_id?, is_active? } */
    public function update(Request $request, int $id): AdminResource|JsonResponse
    {
        if (! Admin::whereKey($id)->exists()) {
            return $this->notFound();
        }
        if ($request->has('email')) {
            $request->merge(['email' => mb_strtolower(trim((string) $request->input('email')))]);
        }
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'email' => ['sometimes', 'string', 'email', 'max:190', Rule::unique('admins', 'email')->ignore($id)],
            'role_id' => ['sometimes', 'integer', 'exists:admin_roles,id'],
            'is_active' => ['sometimes', 'boolean'],
        ], $this->messages());
        $me = $request->user();

        $admin = DB::transaction(function () use ($id, $data, $me) {
            $this->lockOwners();
            $admin = Admin::with('role')->lockForUpdate()->findOrFail($id);
            $before = $this->auditFields($admin);

            if ($admin->isOwner()) {
                $this->checkCanChangeOwner($me);
            }
            if (isset($data['role_id']) && (int) $data['role_id'] !== $admin->role_id) {
                if ($admin->is($me)) {
                    throw ValidationException::withMessages(['role_id' => 'You can\'t change your own role. Ask another Owner.']);
                }
                $this->checkOwnerRole($me, (int) $data['role_id']);
            }
            if (array_key_exists('is_active', $data) && ! $data['is_active'] && $admin->is($me)) {
                throw ValidationException::withMessages(['is_active' => 'You can\'t deactivate your own account.']);
            }

            $admin->fill(collect($data)->only(['name', 'email', 'role_id'])->map(fn ($v) => is_string($v) ? trim($v) : $v)->all());
            if (array_key_exists('is_active', $data)) {
                $admin->is_active = (bool) $data['is_active'];
            }
            $admin->save();
            $admin->load('role');
            $wasActiveOwner = $before['role'] === AdminRole::OWNER && $before['is_active'];
            if ($wasActiveOwner && ! ($admin->isOwner() && $admin->is_active)) {
                // With the rules above the acting Owner always stays one, so this is a safety net.
                $this->ensureAnActiveOwner();
            }

            if (! $admin->is_active && $before['is_active']) {
                $this->tokens->revokeAll($admin); // signed out everywhere
            }
            $changes = Audit::diff($before, $this->auditFields($admin));
            if ($changes) {
                $action = match (true) {
                    ! $admin->is_active && $before['is_active'] => 'admin.deactivated',
                    $admin->is_active && ! $before['is_active'] => 'admin.activated',
                    default => 'admin.updated',
                };
                $this->audit->record($action, "Admin {$admin->email} ".str_replace('admin.', '', $action).'.', 'admin', $admin->id, $changes);
            }

            return $admin;
        });

        return new AdminResource($admin);
    }

    /** POST /api/admin/v1/admins/{id}/reset-password { password } - signs that admin out everywhere. */
    public function resetPassword(Request $request, int $id): JsonResponse
    {
        $admin = Admin::with('role')->find($id);
        if (! $admin) {
            return $this->notFound();
        }
        $data = $request->validate([
            'password' => ['required', 'string', 'max:128', Password::min(12)->letters()->numbers()],
        ], $this->messages());
        if ($admin->isOwner()) {
            $this->checkCanChangeOwner($request->user());
        }

        DB::transaction(function () use ($admin, $data) {
            $admin->forceFill(['password' => $data['password']])->save();
            $this->tokens->revokeAll($admin);
            // No before/after: never log anything about a password but the fact it changed.
            $this->audit->record('admin.password_reset', "Password reset for {$admin->email}; signed out everywhere.", 'admin', $admin->id);
        });

        return response()->json(['message' => 'Password changed. The admin has been signed out everywhere.']);
    }

    private function auditFields(Admin $admin): array
    {
        return ['name' => $admin->name, 'email' => $admin->email, 'role' => $admin->role?->name, 'is_active' => (bool) $admin->is_active];
    }

    /** Only an Owner may give someone the Owner role. */
    private function checkOwnerRole(Admin $me, int $roleId): void
    {
        if (AdminRole::find($roleId)?->isOwner() && ! $me->isOwner()) {
            throw ValidationException::withMessages(['role_id' => 'Only an Owner can give someone the Owner role.']);
        }
    }

    private function checkCanChangeOwner(Admin $me): void
    {
        if (! $me->isOwner()) {
            throw ValidationException::withMessages(['admin' => 'Only an Owner can change an Owner\'s account.']);
        }
    }

    /** Locks the Owners' rows, so two requests can't each remove "the other" last Owner. */
    private function lockOwners(): void
    {
        $owner = AdminRole::owner();
        if ($owner) {
            Admin::where('role_id', $owner->id)->lockForUpdate()->get(['id']);
        }
    }

    private function ensureAnActiveOwner(): void
    {
        $owner = AdminRole::owner();
        if (! $owner || ! Admin::where('role_id', $owner->id)->where('is_active', true)->exists()) {
            // Thrown inside the transaction: the change is rolled back.
            throw ValidationException::withMessages(['role_id' => 'There must always be at least one active Owner.']);
        }
    }

    private function messages(): array
    {
        return [
            'email.unique' => 'There is already an admin with this email.',
            'role_id.exists' => 'Choose a role from the list.',
            'role_id.required' => 'Choose a role.',
        ];
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Admin not found.'], 404);
    }
}
