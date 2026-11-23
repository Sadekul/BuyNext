<?php

namespace App\Http\Middleware;

use App\Models\Admin;
use App\Models\Customer;
use App\Services\TokenPairs;
use App\Services\TwoFactor;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * After auth:sanctum: the token must be an ACCESS token of the right kind.
 *   token.kind:customer  - storefront routes (customer tokens only)
 *   token.kind:admin     - admin routes (admin tokens only)
 * A customer token on an admin route gets 403, whatever the browser shows.
 * Refresh tokens can't be used as access tokens (401).
 *
 * Phase 9 (part A), two-step sign-in:
 *   token.kind:admin,setup - also accepts the LIMITED setup token (ability
 *                            "admin:setup"): only GET /me, logout, and the
 *                            two enrolment routes are marked like this.
 * Everywhere else an admin gets 403 "two_factor_setup_required" with a limited
 * token, or with a full one while the store requires two-step sign-in and
 * this admin hasn't set it up (Settings → Security).
 */
class EnsureTokenKind
{
    public function handle(Request $request, Closure $next, string $kind, ?string $allow = null): Response
    {
        $account = $request->user();
        $token = $account?->currentAccessToken();

        if (! $account || ! $token || collect($token->abilities)->contains(fn ($ability) => str_starts_with($ability, 'refresh:'))) {
            return response()->json(['message' => __('Unauthenticated.')], 401);
        }
        // Phase 9 (part A): a limited setup token has "admin:setup" instead of "admin".
        $limited = $account instanceof Admin && TokenPairs::isLimited($token);
        if (TokenPairs::kindOf($account) !== $kind || (! $limited && ! $token->can($kind))) {
            return response()->json(['message' => __('This action is unauthorized.')], 403);
        }
        if (! $account->is_active) {
            $account->tokens()->delete();

            return response()->json(['message' => __('This account has been disabled.'), 'code' => 'account_disabled'], 403);
        }
        if ($account instanceof Admin && $allow !== 'setup' && ($limited || app(TwoFactor::class)->setupRequired($account))) {
            return response()->json(['message' => 'Set up two-step sign-in to continue.', 'code' => 'two_factor_setup_required'], 403);
        }
        if ($account instanceof Customer && ! $account->hasVerifiedEmail()) {
            return response()->json(['message' => __('Please verify your email first.'), 'code' => 'email_unverified'], 403);
        }

        return $next($request);
    }
}
