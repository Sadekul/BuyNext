<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Roles and permissions are enforced by the server on every admin route. */
class AdminPermissionsTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    // The only admin routes anyone signed in (or not yet) may use.
    private const OPEN = ['POST api/admin/v1/auth/login', 'POST api/admin/v1/auth/refresh', 'POST api/admin/v1/auth/logout', 'GET api/admin/v1/me'];

    /** @return list<RoutingRoute> */
    private function adminRoutes(): array
    {
        return array_values(array_filter(Route::getRoutes()->getRoutes(), fn (RoutingRoute $route) => str_starts_with($route->uri(), 'api/admin/v1/')));
    }

    private function routeName(RoutingRoute $route): string
    {
        return collect($route->methods())->reject(fn ($m) => $m === 'HEAD')->first().' '.$route->uri();
    }

    public function test_every_admin_route_names_a_known_permission(): void
    {
        $routes = $this->adminRoutes();
        $this->assertGreaterThan(50, count($routes));

        foreach ($routes as $route) {
            $permissions = collect($route->gatherMiddleware())
                ->filter(fn ($m) => is_string($m) && str_starts_with($m, 'can.admin:'))
                ->map(fn ($m) => substr($m, strlen('can.admin:')));

            if (in_array($this->routeName($route), self::OPEN, true)) {
                $this->assertCount(0, $permissions, $this->routeName($route).' should not need a permission');

                continue;
            }
            $this->assertCount(1, $permissions, $this->routeName($route).' has no can.admin:<permission> middleware');
            $this->assertTrue(Permissions::exists($permissions->first()), $this->routeName($route)." uses an unknown permission {$permissions->first()}");
        }
    }

    public function test_an_admin_whose_role_grants_nothing_is_refused_everywhere_but_me(): void
    {
        $headers = $this->signInAdmin(Admin::factory()->role([])->create());

        foreach ($this->adminRoutes() as $route) {
            if (in_array($this->routeName($route), self::OPEN, true)) {
                continue;
            }
            $method = explode(' ', $this->routeName($route))[0];
            $uri = '/'.preg_replace(['/\{number\}/', '/\{[a-z_]+\}/'], ['BN-100001', '1'], $route->uri());

            $this->asAdmin($headers, $method, $uri)
                ->assertForbidden()
                ->assertExactJson([
                    'message' => 'Your role doesn\'t allow this.',
                    'code' => 'permission_denied',
                    'permission' => str_replace('can.admin:', '', collect($route->gatherMiddleware())->first(fn ($m) => is_string($m) && str_starts_with($m, 'can.admin:'))),
                ]);
        }
        $this->asAdmin($headers, 'GET', '/api/admin/v1/me')->assertOk()->assertJsonPath('data.permissions', []);
    }

    public function test_me_lists_the_role_and_its_permissions(): void
    {
        $owner = $this->adminHeaders();
        $this->asAdmin($owner, 'GET', '/api/admin/v1/me')->assertOk()
            ->assertJsonPath('data.role.name', 'Owner')
            ->assertJsonPath('data.permissions', Permissions::all());

        $sales = $this->signInAdmin(Admin::factory()->role('Sales staff')->create());
        $this->asAdmin($sales, 'GET', '/api/admin/v1/me')->assertOk()
            ->assertJsonPath('data.role.name', 'Sales staff')
            ->assertJsonPath('data.permissions', ['orders.view', 'orders.edit', 'invoices.create', 'shipments.create', 'credit_memos.create', 'customers.view']);
    }

    public function test_sales_staff_work_on_orders_but_cannot_touch_products(): void
    {
        $product = $this->product();
        $headers = $this->signInAdmin(Admin::factory()->role('Sales staff')->create());

        $this->asAdmin($headers, 'GET', '/api/admin/v1/orders')->assertOk();
        $this->asAdmin($headers, 'GET', '/api/admin/v1/customers')->assertOk();
        $this->asAdmin($headers, 'PATCH', "/api/admin/v1/products/{$product->id}", ['price' => '1.00'])
            ->assertForbidden()->assertJsonPath('code', 'permission_denied')->assertJsonPath('permission', 'products.edit');
        $this->asAdmin($headers, 'PATCH', '/api/admin/v1/customers/1', ['is_active' => false])->assertForbidden()->assertJsonPath('permission', 'customers.edit');
        $this->assertSame('10.00', $product->fresh()->price);
    }

    public function test_a_viewer_can_look_but_not_change(): void
    {
        $product = $this->product();
        $headers = $this->signInAdmin(Admin::factory()->role('Viewer')->create());

        foreach (['/api/admin/v1/overview', '/api/admin/v1/products', '/api/admin/v1/orders', '/api/admin/v1/coupons',
            '/api/admin/v1/pages', '/api/admin/v1/settings', '/api/admin/v1/reports/sales', '/api/admin/v1/audit'] as $uri) {
            $this->asAdmin($headers, 'GET', $uri)->assertOk();
        }
        $this->asAdmin($headers, 'DELETE', "/api/admin/v1/products/{$product->id}")->assertForbidden()->assertJsonPath('permission', 'products.delete');
        $this->asAdmin($headers, 'PATCH', '/api/admin/v1/settings', ['general' => ['store_name' => 'X']])->assertForbidden();
        $this->asAdmin($headers, 'GET', '/api/admin/v1/admins')->assertForbidden()->assertJsonPath('permission', 'admins.manage');
    }

    public function test_a_permission_change_applies_at_once(): void
    {
        $admin = Admin::factory()->role(['orders.view'])->create();
        $headers = $this->signInAdmin($admin);
        $this->asAdmin($headers, 'GET', '/api/admin/v1/coupons')->assertForbidden();

        $admin->role->update(['permissions' => ['orders.view', 'coupons.view']]);
        $this->asAdmin($headers, 'GET', '/api/admin/v1/coupons')->assertOk();
    }
}
