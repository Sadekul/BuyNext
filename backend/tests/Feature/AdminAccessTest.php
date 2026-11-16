<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Customer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

class AdminAccessTest extends TestCase
{
    use ReadsCodes, RefreshDatabase;

    private const ADMIN_ROUTES = [
        ['GET', '/api/admin/v1/me'],
        ['GET', '/api/admin/v1/customers'],
        ['GET', '/api/admin/v1/customers/1'],
        ['PATCH', '/api/admin/v1/customers/1'],
        ['POST', '/api/admin/v1/auth/logout'],
    ];

    protected function setUp(): void
    {
        parent::setUp();
        Admin::factory()->create(['email' => 'boss@buynest.test']);
        Customer::factory()->create(['email' => 'ava@example.com', 'first_name' => 'Ava']);
    }

    private function adminToken(): string
    {
        return $this->postJson('/api/admin/v1/auth/login', ['email' => 'boss@buynest.test', 'password' => 'AdminPass123'])
            ->assertOk()->json('data.tokens.access_token');
    }

    public function test_admins_sign_in_with_their_own_accounts(): void
    {
        $this->getJson('/api/admin/v1/me', $this->bearer($this->adminToken()))->assertOk()->assertJsonPath('data.email', 'boss@buynest.test');
    }

    public function test_a_customer_cannot_sign_in_to_the_admin_even_with_the_right_password(): void
    {
        $this->postJson('/api/admin/v1/auth/login', ['email' => 'ava@example.com', 'password' => 'Password123'])->assertUnprocessable();
    }

    public function test_an_admin_cannot_sign_in_to_the_storefront(): void
    {
        $this->postJson('/api/v1/auth/login', ['email' => 'boss@buynest.test', 'password' => 'AdminPass123'])->assertUnprocessable();
    }

    public function test_every_admin_route_refuses_customer_tokens(): void
    {
        $customer = $this->postJson('/api/v1/auth/login', ['email' => 'ava@example.com', 'password' => 'Password123'])->json('data.tokens.access_token');

        foreach (self::ADMIN_ROUTES as [$method, $uri]) {
            $this->app['auth']->forgetGuards();
            $this->json($method, $uri, ['is_active' => false], $this->bearer($customer))->assertForbidden();
            $this->app['auth']->forgetGuards();
            $this->json($method, $uri)->assertUnauthorized();
        }
        $this->assertTrue(Customer::sole()->is_active);
    }

    public function test_storefront_routes_refuse_admin_tokens(): void
    {
        $this->getJson('/api/v1/me', $this->bearer($this->adminToken()))->assertForbidden();
    }

    public function test_admin_refresh_tokens_cannot_renew_a_customer_session_or_vice_versa(): void
    {
        $adminRefresh = $this->postJson('/api/admin/v1/auth/login', ['email' => 'boss@buynest.test', 'password' => 'AdminPass123'])->json('data.tokens.refresh_token');
        $customerRefresh = $this->postJson('/api/v1/auth/login', ['email' => 'ava@example.com', 'password' => 'Password123'])->json('data.tokens.refresh_token');

        $this->postJson('/api/v1/auth/refresh', ['refresh_token' => $adminRefresh])->assertUnauthorized();
        $this->postJson('/api/admin/v1/auth/refresh', ['refresh_token' => $customerRefresh])->assertUnauthorized();
        $this->postJson('/api/admin/v1/auth/refresh', ['refresh_token' => $adminRefresh])->assertOk();
    }

    public function test_admins_list_and_search_customers_without_private_fields(): void
    {
        Customer::factory()->unverified()->create(['first_name' => 'Rafi', 'email' => 'rafi@example.com']);
        Customer::factory()->blocked()->create(['first_name' => 'Zed']);
        $token = $this->adminToken();

        $all = $this->getJson('/api/admin/v1/customers', $this->bearer($token))->assertOk();
        $all->assertJsonPath('meta.total', 3)->assertJsonMissingPath('data.0.password');
        $this->assertSame(['id', 'first_name', 'last_name', 'email', 'phone', 'email_verified_at', 'email_verified', 'is_active', 'status', 'group', 'orders_count',
            'created_by_admin', 'last_login_at', 'created_at'], array_keys($all->json('data.0')));

        $this->getJson('/api/admin/v1/customers?search=rafi', $this->bearer($token))->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.first_name', 'Rafi');
        $this->getJson('/api/admin/v1/customers?status=unverified', $this->bearer($token))->assertJsonPath('meta.total', 1);
        $this->getJson('/api/admin/v1/customers?status=blocked', $this->bearer($token))->assertJsonPath('data.0.first_name', 'Zed');
        $this->getJson('/api/admin/v1/customers?search=%25', $this->bearer($token))->assertJsonPath('meta.total', 0);
        $this->getJson('/api/admin/v1/customers?status=everyone', $this->bearer($token))->assertJsonValidationErrors('status');
    }

    public function test_blocking_a_customer_signs_them_out_everywhere(): void
    {
        $this->postJson('/api/v1/auth/login', ['email' => 'ava@example.com', 'password' => 'Password123']);
        $id = Customer::sole()->id;

        $this->patchJson("/api/admin/v1/customers/{$id}", ['is_active' => false], $this->bearer($this->adminToken()))
            ->assertOk()->assertJsonPath('data.is_active', false);
        $this->assertSame(0, PersonalAccessToken::where('tokenable_type', Customer::class)->count());

        $this->patchJson("/api/admin/v1/customers/{$id}", ['is_active' => true], $this->bearer($this->adminToken()))->assertJsonPath('data.is_active', true);
        $this->getJson('/api/admin/v1/customers/999', $this->bearer($this->adminToken()))->assertNotFound();
    }

    public function test_the_create_admin_command_makes_an_admin(): void
    {
        $this->artisan('buynest:create-admin', ['email' => 'Ops@BuyNest.test', '--name' => 'Ops Lead'])
            ->expectsQuestion('Password (at least 12 characters, letters and numbers)', 'LongEnough2026')
            ->assertSuccessful();
        $this->assertDatabaseHas('admins', ['email' => 'ops@buynest.test', 'name' => 'Ops Lead']);
        $this->assertDatabaseMissing('customers', ['email' => 'ops@buynest.test']);
    }
}
