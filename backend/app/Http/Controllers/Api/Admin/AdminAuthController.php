<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminResource;
use App\Models\Admin;
use App\Models\AdminTwoFactorChallenge;
use App\Services\Audit;
use App\Services\TokenPairs;
use App\Services\TwoFactor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Shop staff sign-in. Only the admins table is checked: customer accounts
 * can't sign in here, even with the right password, and their tokens are
 * refused by every admin route.
 *
 * Phase 9 (part A): with two-step sign-in on, the right password only gives
 * a challenge; POST /auth/two-factor with a code from the authenticator app
 * (or a recovery code) gives the tokens. When the store requires two-step
 * sign-in and the admin hasn't set it up, the password gives a limited token
 * that only reaches the setup (see TokenPairs, EnsureTokenKind).
 */
class AdminAuthController extends Controller
{
    public function __construct(private TokenPairs $tokens, private Audit $audit, private TwoFactor $twoFactor) {}

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

        // Phase 9 (part A): the second step. No tokens yet; last_login_at waits for the code.
        if ($admin->hasTwoFactor()) {
            [$challenge, $expiresAt] = $this->twoFactor->createChallenge($admin);

            return response()->json(['data' => [
                'two_factor_required' => true,
                'challenge' => $challenge,
                'expires_at' => $expiresAt->toIso8601ZuluString(),
            ]]);
        }
        $setup = $this->twoFactor->setupRequired($admin);

        return $this->signedIn($admin, $request->boolean('remember'), "{$admin->email} signed in.".($setup ? ' Two-step sign-in must be set up first.' : ''), $setup);
    }

    /**
     * POST /api/admin/v1/auth/two-factor { challenge, code | recovery_code, remember }
     * Phase 9 (part A): the second sign-in step → { data: { admin, tokens } }.
     * The challenge works once, for 5 minutes; the 5th wrong code burns it.
     */
    public function twoFactor(Request $request): JsonResponse
    {
        $data = $request->validate([
            'challenge' => ['required', 'string', 'max:100'],
            'code' => ['nullable', 'string', 'max:20'],
            'recovery_code' => ['nullable', 'string', 'max:40'],
            'remember' => ['sometimes', 'boolean'],
        ]);
        $useRecovery = filled($data['recovery_code'] ?? null) && blank($data['code'] ?? null);
        if (! $useRecovery && blank($data['code'] ?? null)) {
            throw ValidationException::withMessages(['code' => 'Enter the 6-digit code from your authenticator app.']);
        }
        $expired = 'This sign-in has expired. Please sign in again.';

        // The challenge row is locked: two guesses at the same moment can't both slip under the limit.
        [$admin, $error] = DB::transaction(function () use ($data, $useRecovery, $expired) {
            $challenge = AdminTwoFactorChallenge::where('token_hash', TwoFactor::challengeHash($data['challenge']))->lockForUpdate()->first();
            if (! $challenge || $challenge->used_at || $challenge->expires_at->isPast() || $challenge->attempts >= TwoFactor::CHALLENGE_ATTEMPTS) {
                return [null, ['challenge' => $expired]];
            }
            $admin = Admin::find($challenge->admin_id);
            if (! $admin?->hasTwoFactor()) {
                return [null, ['challenge' => $expired]];
            }

            $ok = $useRecovery
                ? $this->twoFactor->useRecoveryCode($admin, $data['recovery_code'])
                : $this->twoFactor->verifyCode($admin, $data['code']);
            if ($ok) {
                $challenge->forceFill(['used_at' => now()])->save();

                return [$admin, null];
            }

            $challenge->increment('attempts');
            $burned = $challenge->attempts >= TwoFactor::CHALLENGE_ATTEMPTS;
            if ($burned) {
                $challenge->forceFill(['used_at' => now()])->save();
            }
            $this->audit->record('admin.two_factor_failed', "Wrong two-step code for {$admin->email}".($burned ? '; sign-in attempt ended.' : '.'),
                'admin', $admin->id, anonymous: true);

            return [null, match (true) {
                $burned => ['challenge' => 'Too many wrong codes. Please sign in again.'],
                $useRecovery => ['recovery_code' => 'That recovery code isn\'t right or was already used.'],
                default => ['code' => 'That code isn\'t right. Check your authenticator app and try again.'],
            }];
        });
        if ($error) {
            throw ValidationException::withMessages($error);
        }
        if (! $admin->is_active) {
            $this->audit->record('admin.sign_in_failed', "Sign-in refused for {$admin->email}: the account is deactivated.", anonymous: true);

            return response()->json(['message' => 'This admin account has been disabled.', 'code' => 'account_disabled'], 403);
        }

        return $this->signedIn($admin, $request->boolean('remember'),
            "{$admin->email} signed in with ".($useRecovery ? 'a recovery code.' : 'two-step sign-in.'));
    }

    private function signedIn(Admin $admin, bool $remember, string $summary, bool $limited = false): JsonResponse
    {
        $admin->forceFill(['last_login_at' => now()])->save();
        $this->audit->record('admin.signed_in', $summary, 'admin', $admin->id, admin: $admin);

        return response()->json(['data' => [
            ...($limited ? ['two_factor_setup_required' => true] : []),
            'admin' => (new AdminResource($admin->load('role')))->withPermissions(),
            'tokens' => $this->tokens->issue($admin, $remember, $limited),
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
