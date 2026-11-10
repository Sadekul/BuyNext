<?php

use App\Http\Middleware\EnsureTokenKind;
use App\Http\Middleware\TrustBffClientIp;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Runs first, so rate limits see the visitor's address (see the class).
        $middleware->api(prepend: [TrustBffClientIp::class]);
        $middleware->alias(['token.kind' => EnsureTokenKind::class]);
        // Check the token kind before route-model binding, so a customer token
        // gets 403 on /api/admin/v1/customers/{id} whether or not that id exists.
        $middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: EnsureTokenKind::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // The API always answers in JSON (Laravel's 401/403/404/422/429 shapes).
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
