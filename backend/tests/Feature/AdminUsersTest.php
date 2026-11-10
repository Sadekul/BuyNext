<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AdminRole;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Admin users and roles (System → Permissions), and the rules that keep the shop manageable. */
class AdminUsersTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private Admin $owner;

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = Admin::factory()->create(['email' => 'owner@buynest.test']);
        $this->headers = $this->signInAdmin($this->owner);
    }

    private function role(string $name): AdminRole
    {
        return AdminRole::where('name', $name)->sole();
    }

    public function test_the_seeded_roles(): void
    {
        $roles = $this->asAdmin($this->headers, 'GET', '/api/admin/v1/roles')->assertOk()->json('data');

        $this->assertSame(['Owner', 'Catalog manager', 'Marketing', 'Sales staff', 'Viewer'], array_column($roles, 'name'));
        $this->assertTrue($roles[0]['is_system']);
        $this->assertSame(Permissions::all(), $roles[0]['permissions']);
        $this->assertSame(1, $roles[0]['admins_count']);
        $this->assertSame(['coupons.view', 'coupons.edit', 'content.view', 'content.edit'], $roles[2]['permissions']);
        $viewer = $roles[4]['permissions'];
        $this->assertContains('reports.view', $viewer);
        $this->assertContains('audit.view', $viewer);
        $this->assertEmpty(array_filter($viewer, fn ($key) => ! str_ends_with($key, '.view')));
    }

    public function test_the_permission_catalog_is_grouped_with_labels(): void
    {
        $groups = $this->asAdmin($this->headers, 'GET', '/api/admin/v1/permissions')->assertOk()->json('data');

        $this->assertSame(['dashboard', 'catalog', 'sales', 'customers', 'marketing', 'content', 'reports', 'settings', 'system'], array_column($groups, 'group'));
        $this->assertSame(['key' => 'orders.edit', 'label' => 'Change order status, add notes, cancel'], $groups[2]['permissions'][1]);
        $this->assertCount(count(Permissions::all()), array_merge(...array_column($groups, 'permissions')));
    }

    public function test_creating_an_admin_who_can_then_sign_in(): void
    {
        $this->asAdmin($this->headers, 'POST', '/api/admin/v1/admins', [
            'name' => 'Sam Sales', 'email' => ' Sam@Example.com ', 'role_id' => $this->role('Sales staff')->id, 'password' => 'short',
        ])->assertUnprocessable()->assertJsonValidationErrors('password');

        $this->asAdmin($this->headers, 'POST', '/api/admin/v1/admins', [
            'name' => 'Sam Sales', 'email' => ' Sam@Example.com ', 'role_id' => $this->role('Sales staff')->id, 'password' => 'SalesPass2026',
        ])->assertCreated()
            ->assertJsonPath('data.email', 'sam@example.com')
            ->assertJsonPath('data.role.name', 'Sales staff')
            ->assertJsonPath('data.is_active', true)
            ->assertJsonMissingPath('data.password');

        $this->postJson('/api/admin/v1/auth/login', ['email' => 'sam@example.com', 'password' => 'SalesPass2026'])->assertOk()
            ->assertJsonPath('data.admin.permissions.0', 'orders.view');
        $this->asAdmin($this->headers, 'POST', '/api/admin/v1/admins', [
            'name' => 'Again', 'email' => 'sam@example.com', 'role_id' => $this->role('Viewer')->id, 'password' => 'SalesPass2026',
        ])->assertUnprocessable()->assertJsonValidationErrors('email');
    }

    public function test_you_cannot_deactivate_or_demote_yourself(): void
    {
        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/admins/{$this->owner->id}", ['is_active' => false])
            ->assertUnprocessable()->assertJsonValidationErrors('is_active');
        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/admins/{$this->owner->id}", ['role_id' => $this->role('Viewer')->id])
            ->assertUnprocessable()->assertJsonValidationErrors('role_id');
        // Your own name is fine.
        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/admins/{$this->owner->id}", ['name' => 'The Owner', 'role_id' => $this->owner->role_id])
            ->assertOk()->assertJsonPath('data.name', 'The Owner');
        $this->assertTrue($this->owner->fresh()->isOwner());
    }

    public function test_only_an_owner_can_make_owners_or_change_them(): void
    {
        $manager = Admin::factory()->role(['admins.manage'])->create();
        $headers = $this->signInAdmin($manager);
        $viewer = Admin::factory()->role('Viewer')->create();

        $this->asAdmin($headers, 'PATCH', "/api/admin/v1/admins/{$manager->id}", ['role_id' => $this->role('Owner')->id])
            ->assertUnprocessable()->assertJsonValidationErrors('role_id');
        $this->asAdmin($headers, 'PATCH', "/api/admin/v1/admins/{$viewer->id}", ['role_id' => $this->role('Owner')->id])
            ->assertUnprocessable()->assertJsonValidationErrors('role_id');
        $this->asAdmin($headers, 'PATCH', "/api/admin/v1/admins/{$this->owner->id}", ['is_active' => false])
            ->assertUnprocessable()->assertJsonValidationErrors('admin');
        $this->asAdmin($headers, 'POST', "/api/admin/v1/admins/{$this->owner->id}/reset-password", ['password' => 'Takeover2026x'])
            ->assertUnprocessable()->assertJsonValidationErrors('admin');
        // Other roles are fine.
        $this->asAdmin($headers, 'PATCH', "/api/admin/v1/admins/{$viewer->id}", ['role_id' => $this->role('Marketing')->id])->assertOk();
    }

    public function test_there_is_always_an_active_owner(): void
    {
        $second = Admin::factory()->create();
        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/admins/{$second->id}", ['role_id' => $this->role('Viewer')->id])->assertOk();

        // The last Owner can't be removed: you can't demote yourself, and only Owners can change Owners.
        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/admins/{$this->owner->id}", ['role_id' => $this->role('Viewer')->id])
            ->assertUnprocessable();
        $this->assertSame(1, Admin::where('role_id', $this->role('Owner')->id)->where('is_active', true)->count());
    }

    public function test_deactivating_signs_the_admin_out_everywhere(): void
    {
        $staff = Admin::factory()->role('Sales staff')->create();
        $staffHeaders = $this->signInAdmin($staff);
        $this->asAdmin($staffHeaders, 'GET', '/api/admin/v1/me')->assertOk();

        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/admins/{$staff->id}", ['is_active' => false])
            ->assertOk()->assertJsonPath('data.is_active', false);

        $this->assertSame(0, $staff->tokens()->count());
        $this->asAdmin($staffHeaders, 'GET', '/api/admin/v1/me')->assertUnauthorized();
        $this->postJson('/api/admin/v1/auth/login', ['email' => $staff->email, 'password' => 'AdminPass123'])->assertForbidden();
    }

    public function test_resetting_a_password_signs_the_admin_out_everywhere(): void
    {
        $staff = Admin::factory()->role('Viewer')->create();
        $staffHeaders = $this->signInAdmin($staff);

        $this->asAdmin($this->headers, 'POST', "/api/admin/v1/admins/{$staff->id}/reset-password", ['password' => 'abc'])
            ->assertUnprocessable()->assertJsonValidationErrors('password');
        $this->asAdmin($this->headers, 'POST', "/api/admin/v1/admins/{$staff->id}/reset-password", ['password' => 'BrandNewPass2026'])->assertOk();

        $this->asAdmin($staffHeaders, 'GET', '/api/admin/v1/me')->assertUnauthorized();
        $this->postJson('/api/admin/v1/auth/login', ['email' => $staff->email, 'password' => 'AdminPass123'])->assertUnprocessable();
        $this->postJson('/api/admin/v1/auth/login', ['email' => $staff->email, 'password' => 'BrandNewPass2026'])->assertOk();
    }

    public function test_listing_and_filtering_admins(): void
    {
        Admin::factory()->role('Viewer')->create(['name' => 'Vera Viewer']);
        Admin::factory()->role('Viewer')->create(['name' => 'Old Hand'])->forceFill(['is_active' => false])->save();

        $this->asAdmin($this->headers, 'GET', '/api/admin/v1/admins?role_id='.$this->role('Viewer')->id.'&status=active')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'Vera Viewer');
        $this->asAdmin($this->headers, 'GET', '/api/admin/v1/admins?search=old')->assertJsonPath('data.0.is_active', false);
        $this->asAdmin($this->headers, 'GET', '/api/admin/v1/admins/999')->assertNotFound();
    }

    public function test_custom_roles(): void
    {
        $id = $this->asAdmin($this->headers, 'POST', '/api/admin/v1/roles', [
            'name' => 'Support', 'description' => 'Helps customers', 'permissions' => ['customers.view', 'orders.view'],
        ])->assertCreated()
            ->assertJsonPath('data.permissions', ['orders.view', 'customers.view']) // catalog order
            ->assertJsonPath('data.is_system', false)
            ->json('data.id');

        $this->asAdmin($this->headers, 'POST', '/api/admin/v1/roles', ['name' => 'Bad', 'permissions' => ['orders.fly']])
            ->assertUnprocessable()->assertJsonValidationErrors('permissions.0');
        $this->asAdmin($this->headers, 'POST', '/api/admin/v1/roles', ['name' => 'support', 'permissions' => []])
            ->assertUnprocessable()->assertJsonValidationErrors('name');

        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/roles/{$id}", ['permissions' => ['customers.view', 'customers.edit']])
            ->assertOk()->assertJsonPath('data.permissions', ['customers.view', 'customers.edit']);

        Admin::factory()->count(2)->create(['role_id' => $id]);
        $this->asAdmin($this->headers, 'DELETE', "/api/admin/v1/roles/{$id}")
            ->assertUnprocessable()->assertJsonPath('errors.role.0', '2 admins have this role. Give them another role first.');

        Admin::where('role_id', $id)->update(['role_id' => $this->role('Viewer')->id]);
        $this->asAdmin($this->headers, 'DELETE', "/api/admin/v1/roles/{$id}")->assertNoContent();
    }

    public function test_the_owner_role_cannot_be_changed_or_deleted(): void
    {
        $owner = $this->role('Owner');

        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/roles/{$owner->id}", ['permissions' => ['orders.view']])
            ->assertUnprocessable()->assertJsonValidationErrors('role');
        $this->asAdmin($this->headers, 'DELETE', "/api/admin/v1/roles/{$owner->id}")
            ->assertUnprocessable()->assertJsonValidationErrors('role');
        $this->assertSame(Permissions::all(), $owner->fresh()->permissionKeys());
    }
}
