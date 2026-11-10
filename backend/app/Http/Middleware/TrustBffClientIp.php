<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The storefront's sign-in service (BFF) calls this API from its server, so
 * every request arrives from the same address. When it proves itself with the
 * shared key (BFF_SHARED_KEY), it may pass the visitor's IP in X-Client-IP, so
 * rate limits apply per visitor instead of to everyone at once. Without the
 * key the header is ignored, so nobody else can fake their address.
 */
class TrustBffClientIp
{
    public function handle(Request $request, Closure $next): Response
    {
        $key = (string) config('buynest.bff_key');
        $clientIp = $request->header('X-Client-IP');

        if ($key !== '' && hash_equals($key, (string) $request->header('X-BuyNest-Bff'))
            && $clientIp && filter_var($clientIp, FILTER_VALIDATE_IP)) {
            $request->server->set('REMOTE_ADDR', $clientIp);
        }

        return $next($request);
    }
}
