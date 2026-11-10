<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminResource;
use App\Models\Admin;
use App\Services\Audit;
use App\Services\TokenPairs;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Shop staff sign-in. Only the admins table is checked: customer accounts
 * can't sign in here, even with the right password, and their tokens are
 * refused by every admin route.
 */
class AdminAuthController extends Controller
{
    public function __construct(private TokenPairs $tokens, private Audit $audit) {}

    /** POST /api/admin/v1/auth/login { email, password, remember } */
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email', 'max:190'],
            'password' => ['required', 'string', 'max:128'],
            'remember' => ['sometimes', 'boolean'],
        ]);
        $admin = Admin::where('email', mb_strtolower(trim($data['email'])))->first();

        $passwordOk = Hash::check($data['password'], $admin?->password ?? '$2y$12$'.str_repeat('a', 53));
        if (! $admin || ! $passwordOk) {
            // No admin_id: nobody signed in. The email shows what was tried (it may not be an account at all).
            $this->audit->record('admin.sign_in_failed', 'Failed admin sign-in for '.mb_substr($data['email'], 0, 190).'.', anonymous: true);
            throw ValidationException::withMessages(['email' => 'The email or password is incorrect.']);
        }
        if (! $admin->is_active) {
            $this->audit->record('admin.sign_in_failed', "Sign-in refused for {$admin->email}: the account is deactivated.", anonymous: true);

            return response()->json(['message' => 'This admin account has been disabled.', 'code' => 'account_disabled'], 403);
        }

        $admin->forceFill(['last_login_at' => now()])->save();
        $this->audit->record('admin.signed_in', "{$admin->email} signed in.", 'admin', $admin->id, admin: $admin);

        return response()->json(['data' => [
            'admin' => (new AdminResource($admin->load('role')))->withPermissions(),
            'tokens' => $this->tokens->issue($admin, $request->boolean('remember')),
        ]]);
    }

    /** POST /api/admin/v1/auth/refresh { refresh_token } */
    public function refresh(Request $request): JsonResponse
    {
        $data = $request->validate(['refresh_token' => ['required', 'string', 'max:200']]);
        $tokens = $this->tokens->refresh($data['refresh_token'], TokenPairs::ADMIN);

        return $tokens
            ? response()->json(['data' => ['tokens' => $tokens]])
            : response()->json(['message' => 'Your session has expired. Please sign in again.'], 401);
    }

    /** POST /api/admin/v1/auth/logout */
    public function logout(Request $request): JsonResponse
    {
        $this->tokens->revokePairOf($request->user()->currentAccessToken());

        return response()->json(['message' => 'Signed out.']);
    }

    /** GET /api/admin/v1/me - with role { id, name } and permissions [keys]. */
    public function me(Request $request): AdminResource
    {
        return (new AdminResource($request->user()->load('role')))->withPermissions();
    }
}
