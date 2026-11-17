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
 */
class RequireBffKey
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! config('buynest.require_bff_key')) {
            return $next($request);
        }

        $key = (string) config('buynest.bff_key');
        if ($key === '' || ! hash_equals($key, (string) $request->header('X-BuyNest-Bff'))) {
            return response()->json(['message' => 'This API only answers the BuyNest store.', 'code' => 'store_only'], 403);
        }

        return $next($request);
    }
}
