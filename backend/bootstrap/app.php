<?php

use App\Http\Middleware\EnsureAdminPermission;
use App\Http\Middleware\EnsureTokenKind;
use App\Http\Middleware\OptionalCustomer;
use App\Http\Middleware\RequireBffKey;
use App\Http\Middleware\SetLocale;
use App\Http\Middleware\TrustBffClientIp;
use App\Support\Locale;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Lang;
use Sentry\Laravel\Integration;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Runs first, so rate limits see the visitor's address (see the class).
        $middleware->api(prepend: [RequireBffKey::class, TrustBffClientIp::class]);
        // Phase 13: the answer's language (Accept-Language on store routes; admin routes are English).
        $middleware->api(append: [SetLocale::class]);
        // ...and before sign-in, throttling and token checks, so their 401/403/429 answers are in that language too.
        $middleware->prependToPriorityList(before: AuthenticatesRequests::class, prepend: SetLocale::class);
        $middleware->alias([
            'token.kind' => EnsureTokenKind::class,
            'customer.optional' => OptionalCustomer::class,
            'can.admin' => EnsureAdminPermission::class,
            // Phase 9 (part B): routes only the store's sign-in service may call, even in development.
            'bff.key' => RequireBffKey::class,
        ]);
        // Check the token kind before route-model binding, so a customer token
        // gets 403 on /api/admin/v1/customers/{id} whether or not that id exists.
        $middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: EnsureTokenKind::class);
        // ...and the permission check too: no permission → 403, never a 404 that tells whether the id exists.
        $middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: EnsureAdminPermission::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // The API always answers in JSON (Laravel's 401/403/404/422/429 shapes).
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
        // Phase 13: framework messages a shopper can see ("Unauthenticated.", "Too Many Attempts.", a 404 or
        // 500) in Bangla when the request's language is Bangla. Our own messages are already translated
        // (__()); admin routes are English. English answers are never touched.
        $exceptions->respond(function (SymfonyResponse $response, Throwable $e, Request $request) {
            if (! $response instanceof JsonResponse || ! $request->is('api/*') || $request->is('api/admin/*', 'api/admin')) {
                return $response;
            }
            // Also for errors raised before SetLocale ran (sign-in, rate limits run earlier in the stack).
            $locale = Locale::requested($request) ?? Locale::storeDefault();
            $response->headers->set('Content-Language', $locale);
            if ($locale !== 'bn') {
                return $response;
            }
            App::setLocale('bn');
            $data = $response->getData(true);
            $message = $data['message'] ?? null;
            if (! is_string($message) || preg_match('/\p{Bengali}/u', $message)) {
                return $response;
            }
            $status = $response->getStatusCode();
            $data['message'] = match (true) {
                Lang::has($message) => __($message),
                $status === 404 => __('Not found.'),
                $status === 405 => __('This action isn\'t allowed here.'),
                $status === 503 => __('Service Unavailable'),
                $status >= 500 => __('Server Error'),
                default => $message,
            };

            return $response->setData($data);
        });
        // Phase 9 (part B): report exceptions to Sentry (does nothing while SENTRY_LARAVEL_DSN is empty).
        Integration::handles($exceptions);
    })->create();
