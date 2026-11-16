<?php

namespace App\Http\Middleware;

use App\Models\Admin;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * can.admin:<key> - the signed-in admin's role must grant <key>
 * (App\Support\Permissions). Runs after token.kind:admin, before the
 * controller, so a refused request changes nothing. The admin app hides what
 * a role can't do, but this is what actually stops it.
 *
 * can.admin:<a>|<b> - any one of the keys is enough (lookup lists that
 * several areas' forms need, such as categories for coupon rules).
 */
class EnsureAdminPermission
{
    public function handle(Request $request, Closure $next, string $permission): Response
    {
        $admin = $request->user();

        $allowed = $admin instanceof Admin
            && collect(explode('|', $permission))->contains(fn (string $key) => $admin->hasPermission($key));
        if (! $allowed) {
            return response()->json([
                'message' => 'Your role doesn\'t allow this.',
                'code' => 'permission_denied',
                'permission' => $permission,
            ], 403);
        }

        return $next($request);
    }
}
