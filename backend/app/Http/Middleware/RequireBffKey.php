<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * In production the API has a public address (the storefront's server
 * functions on Vercel reach it over the internet), but only the storefront's
 * sign-in service should talk to it. With BUYNEST_REQUIRE_BFF_KEY=true every
 * /api request must carry the shared key (BFF_SHARED_KEY) in X-BuyNest-Bff;
 * anything else gets 403 before routing. The health check (/up) and product
 * photos (/storage) aren't API routes and stay open. Off in local development,
 * where the browser checks call the API directly.
 *
 * Phase 18: the couriers' webhooks (DIRECT_PATHS) are exempt: Steadfast and
 * Pathao post them from their own servers, with their own shared secret.
 *
 * Phase 9 (part B): as route middleware `bff.key:always` it checks the key
 * whatever BUYNEST_REQUIRE_BFF_KEY says (browser error reports: only the
 * sign-in service may forward them), and refuses when no key is configured.
 */
class RequireBffKey
{
    /** Phase 18: API routes outside services call directly (never through the sign-in service). */
    public const DIRECT_PATHS = ['api/v1/couriers/steadfast/webhook', 'api/v1/couriers/pathao/webhook'];

    public function handle(Request $request, Closure $next, ?string $mode = null): Response
    {
        if ($mode !== 'always' && ! config('buynest.require_bff_key')) {
            return $next($request);
        }
        // Phase 18: the couriers post their webhooks straight to the API (their own shared secret is the proof).
        if ($mode !== 'always' && $request->is(...self::DIRECT_PATHS)) {
            return $next($request);
        }

        $key = (string) config('buynest.bff_key');
        if ($key === '' || ! hash_equals($key, (string) $request->header('X-BuyNest-Bff'))) {
            return response()->json(['message' => 'This API only answers the BuyNest store.', 'code' => 'store_only'], 403);
        }

        return $next($request);
    }
}
