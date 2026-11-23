<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * For routes that guests AND customers may use (placing an order).
 * No Authorization header: a guest. A Bearer token: it must be a valid
 * customer access token, checked exactly like token.kind:customer. A bad,
 * expired, refresh, or admin token is refused (401/403) instead of silently
 * becoming a guest order, so the sign-in service knows to renew the session.
 */
class OptionalCustomer
{
    public function __construct(private EnsureTokenKind $tokenKind) {}

    public function handle(Request $request, Closure $next): Response
    {
        if ($request->bearerToken() === null) {
            return $next($request);
        }

        // Like auth:sanctum: from now on $request->user() reads the token.
        Auth::shouldUse('sanctum');
        if (! $request->user()) {
            return response()->json(['message' => __('Unauthenticated.')], 401);
        }

        return $this->tokenKind->handle($request, $next, 'customer');
    }
}
