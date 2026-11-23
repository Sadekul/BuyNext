<?php

namespace App\Http\Middleware;

use App\Support\Locale;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Symfony\Component\HttpFoundation\Response;

/**
 * Phase 13: the language of the answer (validation and error messages,
 * product content, emails sent during the request).
 *
 * Store routes: the first language of Accept-Language when it is en or bn
 * ("bn", "bn-BD", "bn-BD,bn;q=0.9"), otherwise the store default
 * (Settings → General, default_locale). The store's sign-in service sends the
 * shopper's choice on every call, also for signed-in customers (their saved
 * customers.locale is only used for emails).
 * Admin routes (/api/admin/*) are always English: the admin is a staff tool.
 * The answer says which language it used in Content-Language.
 */
class SetLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        $locale = $request->is('api/admin/*') || $request->is('api/admin')
            ? Locale::FALLBACK
            : (Locale::requested($request) ?? Locale::storeDefault());
        App::setLocale($locale);

        $response = $next($request);
        $response->headers->set('Content-Language', $locale);

        return $response;
    }
}
