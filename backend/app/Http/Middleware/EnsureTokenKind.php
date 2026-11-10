<?php

namespace App\Http\Middleware;

use App\Models\Customer;
use App\Services\TokenPairs;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * After auth:sanctum: the token must be an ACCESS token of the right kind.
 *   token.kind:customer  - storefront routes (customer tokens only)
 *   token.kind:admin     - admin routes (admin tokens only)
 * A customer token on an admin route gets 403, whatever the browser shows.
 * Refresh tokens can't be used as access tokens (401).
 */
class EnsureTokenKind
{
    public function handle(Request $request, Closure $next, string $kind): Response
    {
        $account = $request->user();
        $token = $account?->currentAccessToken();

        if (! $account || ! $token || collect($token->abilities)->contains(fn ($ability) => str_starts_with($ability, 'refresh:'))) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }
        if (TokenPairs::kindOf($account) !== $kind || ! $token->can($kind)) {
            return response()->json(['message' => 'This action is unauthorized.'], 403);
        }
        if (! $account->is_active) {
            $account->tokens()->delete();

            return response()->json(['message' => 'This account has been disabled.', 'code' => 'account_disabled'], 403);
        }
        if ($account instanceof Customer && ! $account->hasVerifiedEmail()) {
            return response()->json(['message' => 'Please verify your email first.', 'code' => 'email_unverified'], 403);
        }

        return $next($request);
    }
}
