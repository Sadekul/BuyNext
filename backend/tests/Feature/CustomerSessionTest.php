<?php

namespace Tests\Feature;

use App\Models\Customer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

class CustomerSessionTest extends TestCase
{
    use ReadsCodes, RefreshDatabase;

    private function signIn(array $overrides = []): TestResponse
    {
        return $this->postJson('/api/v1/auth/login', array_merge(['email' => 'ava@example.com', 'password' => 'Password123'], $overrides));
    }

    protected function setUp(): void
    {
        parent::setUp();
        Customer::factory()->create(['email' => 'ava@example.com', 'first_name' => 'Ava']);
    }

    public function test_sign_in_returns_the_profile_and_a_token_pair(): void
    {
        $this->signIn(['email' => 'AVA@example.com'])
            ->assertOk()
            ->assertJsonPath('data.customer.first_name', 'Ava')
            ->assertJsonStructure(['data' => ['tokens' => ['access_token', 'access_expires_in', 'refresh_token', 'refresh_expires_in']]])
            ->assertJsonMissingPath('data.customer.password');
        $this->assertNotNull(Customer::sole()->last_login_at);
    }

    public function test_wrong_password_and_unknown_email_get_the_same_answer(): void
    {
        $wrong = $this->signIn(['password' => 'Nope12345'])->assertUnprocessable();
        $unknown = $this->signIn(['email' => 'nobody@example.com'])->assertUnprocessable();
        $this->assertSame($wrong->json(), $unknown->json());
    }

    public function test_keep_me_signed_in_makes_the_refresh_token_last_seven_days(): void
    {
        $this->assertSame(86400, $this->signIn()->json('data.tokens.refresh_expires_in'));
        $this->assertSame(7 * 86400, $this->signIn(['remember' => true])->json('data.tokens.refresh_expires_in'));
    }

    public function test_access_tokens_expire_after_an_hour(): void
    {
        $access = $this->signIn()->json('data.tokens.access_token');
        $this->travel(61)->minutes();
        $this->getJson('/api/v1/me', $this->bearer($access))->assertUnauthorized();
    }

    public function test_refresh_rotates_the_pair(): void
    {
        $tokens = $this->signIn(['remember' => true])->json('data.tokens');

        $new = $this->postJson('/api/v1/auth/refresh', ['refresh_token' => $tokens['refresh_token']])->assertOk()->json('data.tokens');
        $this->assertTrue($new['remember'], '"Keep me signed in" carries over');
        $this->getJson('/api/v1/me', $this->bearer($new['access_token']))->assertOk();

        // The old pair stopped working.
        $this->postJson('/api/v1/auth/refresh', ['refresh_token' => $tokens['refresh_token']])->assertUnauthorized();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/me', $this->bearer($tokens['access_token']))->assertUnauthorized();
    }

    public function test_a_refresh_token_is_not_an_access_token(): void
    {
        $refresh = $this->signIn()->json('data.tokens.refresh_token');
        $this->getJson('/api/v1/me', $this->bearer($refresh))->assertUnauthorized();
    }

    public function test_an_access_token_cannot_refresh(): void
    {
        $access = $this->signIn()->json('data.tokens.access_token');
        $this->postJson('/api/v1/auth/refresh', ['refresh_token' => $access])->assertUnauthorized();
    }

    public function test_sign_out_revokes_this_device_only(): void
    {
        $phone = $this->signIn()->json('data.tokens');
        $laptop = $this->signIn()->json('data.tokens');

        $this->postJson('/api/v1/auth/logout', [], $this->bearer($phone['access_token']))->assertOk();
        $this->app['auth']->forgetGuards();

        $this->getJson('/api/v1/me', $this->bearer($phone['access_token']))->assertUnauthorized();
        $this->postJson('/api/v1/auth/refresh', ['refresh_token' => $phone['refresh_token']])->assertUnauthorized();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/me', $this->bearer($laptop['access_token']))->assertOk();
    }

    public function test_profile_updates_name_and_phone_but_never_email(): void
    {
        $access = $this->signIn()->json('data.tokens.access_token');

        $this->patchJson('/api/v1/me', ['first_name' => ' Ava Marie ', 'phone' => '+44 20 7946 0958', 'email' => 'hacker@example.com', 'is_active' => false], $this->bearer($access))
            ->assertOk()
            ->assertJsonPath('data.first_name', 'Ava Marie')
            ->assertJsonPath('data.phone', '+442079460958')
            ->assertJsonPath('data.email', 'ava@example.com');
        $this->assertTrue(Customer::sole()->is_active);

        $this->patchJson('/api/v1/me', ['phone' => 'call me'], $this->bearer($access))->assertJsonValidationErrors('phone');
    }

    public function test_a_blocked_customer_cannot_sign_in_and_existing_sessions_stop(): void
    {
        $tokens = $this->signIn()->json('data.tokens');
        Customer::sole()->forceFill(['is_active' => false])->save();

        $this->signIn()->assertForbidden()->assertJsonPath('code', 'account_disabled');
        $this->getJson('/api/v1/me', $this->bearer($tokens['access_token']))->assertForbidden();
        $this->assertSame(0, PersonalAccessToken::count());
    }

    public function test_tokens_are_stored_hashed(): void
    {
        $access = $this->signIn()->json('data.tokens.access_token');
        [, $plain] = explode('|', $access, 2);
        $this->assertDatabaseMissing('personal_access_tokens', ['token' => $plain]);
    }
}
