<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminResource;
use App\Models\Admin;
use App\Services\Audit;
use App\Services\TokenPairs;
use App\Services\TwoFactor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Phase 9 (part A): Account → Two-step sign-in (an authenticator app), and
 * the Owner's reset for another admin. Enrolling needs no permission key: it
 * only changes the signed-in admin's own account. Begin and confirm also
 * accept the limited setup token (the store requires two-step sign-in).
 */
class TwoFactorController extends Controller
{
    public function __construct(private TwoFactor $twoFactor, private TokenPairs $tokens, private Audit $audit) {}

    /** POST /api/admin/v1/me/two-factor → { data: { secret, otpauth_url, qr_svg } } (not active until confirmed). */
    public function begin(Request $request): JsonResponse
    {
        $admin = $request->user();
        if ($admin->hasTwoFactor()) {
            throw ValidationException::withMessages(['two_factor' => 'Two-step sign-in is already on.']);
        }

        return response()->json(['data' => $this->twoFactor->begin($admin)]);
    }

    /**
     * POST /api/admin/v1/me/two-factor/confirm { code } → { data: { recovery_codes, admin, tokens? } }.
     * With the limited setup token, that pair is signed out and a full pair comes back in `tokens`.
     */
    public function confirm(Request $request): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'string', 'max:20']]);
        $admin = $request->user();
        if ($admin->hasTwoFactor()) {
            throw ValidationException::withMessages(['two_factor' => 'Two-step sign-in is already on.']);
        }
        if (! $admin->two_factor_secret) {
            throw ValidationException::withMessages(['two_factor' => 'Start the setup first.']);
        }
        if (! $this->twoFactor->verifyCode($admin, $data['code'])) {
            throw ValidationException::withMessages(['code' => 'That code isn\'t right. Check your authenticator app and try again.']);
        }

        $current = $admin->currentAccessToken();
        $limited = TokenPairs::isLimited($current);
        [$codes, $tokens] = DB::transaction(function () use ($admin, $current, $limited) {
            $codes = $this->twoFactor->confirm($admin);
            $this->audit->record('admin.two_factor_enabled', "{$admin->email} turned on two-step sign-in.", 'admin', $admin->id);
            $tokens = null;
            if ($limited) {
                $remember = $this->tokens->remembers($current);
                $this->tokens->revokePairOf($current);
                $tokens = $this->tokens->issue($admin, $remember);
            }

            return [$codes, $tokens];
        });

        return response()->json(['data' => [
            'recovery_codes' => $codes,
            'admin' => (new AdminResource($admin->fresh()->load('role')))->withPermissions(),
            ...($tokens ? ['tokens' => $tokens] : []),
        ]]);
    }

    /** POST /api/admin/v1/me/two-factor/recovery-codes { password } → { data: { recovery_codes } } (the old ones stop working). */
    public function recoveryCodes(Request $request): JsonResponse
    {
        $data = $request->validate(['password' => ['required', 'string', 'max:128']]);
        $admin = $request->user();
        $this->checkPassword($admin, $data['password']);
        if (! $admin->hasTwoFactor()) {
            throw ValidationException::withMessages(['two_factor' => 'Two-step sign-in is off.']);
        }

        $codes = DB::transaction(function () use ($admin) {
            $codes = $this->twoFactor->regenerateRecoveryCodes($admin);
            $this->audit->record('admin.two_factor_recovery_codes_regenerated', "{$admin->email} made new recovery codes.", 'admin', $admin->id);

            return $codes;
        });

        return response()->json(['data' => ['recovery_codes' => $codes]]);
    }

    /** DELETE /api/admin/v1/me/two-factor { password, code (6 digits or a recovery code) } */
    public function disable(Request $request): JsonResponse
    {
        $data = $request->validate([
            'password' => ['required', 'string', 'max:128'],
            'code' => ['required', 'string', 'max:40'],
        ]);
        $admin = $request->user();
        if (! $admin->hasTwoFactor()) {
            throw ValidationException::withMessages(['two_factor' => 'Two-step sign-in is off.']);
        }
        if ($this->twoFactor->requiredByStore()) {
            throw ValidationException::withMessages(['two_factor' => 'The store requires two-step sign-in for every admin, so you can\'t turn it off.']);
        }
        $this->checkPassword($admin, $data['password']);
        $code = trim($data['code']);
        $ok = preg_match('/^\d{6}$/', $code) ? $this->twoFactor->verifyCode($admin, $code) : $this->twoFactor->useRecoveryCode($admin, $code);
        if (! $ok) {
            throw ValidationException::withMessages(['code' => 'That code isn\'t right. Enter a code from your authenticator app or a recovery code.']);
        }

        DB::transaction(function () use ($admin) {
            $this->twoFactor->disable($admin);
            $this->audit->record('admin.two_factor_disabled', "{$admin->email} turned off two-step sign-in.", 'admin', $admin->id);
        });

        return response()->json([
            'message' => 'Two-step sign-in is off.',
            'data' => (new AdminResource($admin->fresh()->load('role')))->withPermissions(),
        ]);
    }

    /** POST /api/admin/v1/admins/{id}/two-factor/reset (admins.manage + Owner): off, and signed out everywhere. */
    public function reset(Request $request, int $id): JsonResponse
    {
        $me = $request->user();
        if (! $me->isOwner()) {
            return response()->json(['message' => 'Only an Owner can reset two-step sign-in.', 'code' => 'owner_only'], 403);
        }
        $admin = Admin::with('role')->find($id);
        if (! $admin) {
            return response()->json(['message' => 'Admin not found.'], 404);
        }
        if ($admin->is($me)) {
            throw ValidationException::withMessages(['two_factor' => 'Use Account → Two-step sign-in to change your own.']);
        }
        if (! $admin->hasTwoFactor()) {
            throw ValidationException::withMessages(['two_factor' => 'This admin doesn\'t use two-step sign-in.']);
        }

        DB::transaction(function () use ($admin) {
            $this->twoFactor->disable($admin);
            $this->tokens->revokeAll($admin);
            $this->audit->record('admin.two_factor_reset', "Two-step sign-in reset for {$admin->email}; signed out everywhere.", 'admin', $admin->id);
        });

        return response()->json([
            'message' => "Two-step sign-in was reset. {$admin->name} has been signed out everywhere.",
            'data' => new AdminResource($admin->fresh()->load('role')),
        ]);
    }

    private function checkPassword(Admin $admin, string $password): void
    {
        if (! Hash::check($password, $admin->password)) {
            throw ValidationException::withMessages(['password' => 'The password is incorrect.']);
        }
    }
}
