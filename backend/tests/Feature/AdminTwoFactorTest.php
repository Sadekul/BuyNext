<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AuditLog;
use App\Services\TwoFactor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 9 (part A): two-step sign-in for admins (TOTP), forced enrolment, Owner controls. */
class AdminTwoFactorTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private Admin $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now()->startOfMinute()); // codes depend on the clock: start each test at a fixed point of a step
        $this->owner = Admin::factory()->create(['email' => 'owner@example.com']);
    }

    private function login(Admin $admin, bool $remember = false): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->postJson('/api/admin/v1/auth/login', ['email' => $admin->email, 'password' => 'AdminPass123', 'remember' => $remember]);
    }

    private function codeFor(Admin $admin, int $offsetSteps = 0): string
    {
        $secret = $admin->fresh()->two_factor_secret;

        return TwoFactor::codeAt(TwoFactor::base32Decode($secret), TwoFactor::stepAt(now()->getTimestamp()) + $offsetSteps);
    }

    private function bearer(string $token): array
    {
        return ['Authorization' => "Bearer {$token}"];
    }

    /** Turns two-step on for $admin through the API; returns [headers, recovery codes]. */
    private function enrol(Admin $admin): array
    {
        $headers = $this->signInAdmin($admin);
        $this->asAdmin($headers, 'POST', '/api/admin/v1/me/two-factor')->assertOk();
        $codes = $this->asAdmin($headers, 'POST', '/api/admin/v1/me/two-factor/confirm', ['code' => $this->codeFor($admin)])
            ->assertOk()->json('data.recovery_codes');
        $this->travel(30)->seconds(); // the next code is a new step

        return [$headers, $codes];
    }

    private function secondStep(string $challenge, array $body): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->postJson('/api/admin/v1/auth/two-factor', ['challenge' => $challenge, ...$body]);
    }

    public function test_enrolment_shows_a_qr_and_stores_the_secret_encrypted_and_the_recovery_codes_hashed(): void
    {
        $headers = $this->signInAdmin($this->owner);
        $this->asAdmin($headers, 'GET', '/api/admin/v1/me')->assertOk()
            ->assertJsonPath('data.two_factor_enabled', false)
            ->assertJsonPath('data.two_factor', ['enabled' => false, 'confirmed_at' => null, 'recovery_codes_left' => 0, 'required' => false]);

        $data = $this->asAdmin($headers, 'POST', '/api/admin/v1/me/two-factor')->assertOk()->json('data');
        $this->assertMatchesRegularExpression('/^[A-Z2-7]{32}$/', $data['secret']);
        $this->assertStringStartsWith('otpauth://totp/BuyNest:owner%40example.com?secret='.$data['secret'].'&issuer=BuyNest', $data['otpauth_url']);
        $this->assertStringStartsWith('<svg', $data['qr_svg']);
        $this->assertStringNotContainsString('<script', $data['qr_svg']);

        // Encrypted at rest: the column is not the secret, but decrypts to it.
        $raw = DB::table('admins')->where('id', $this->owner->id)->value('two_factor_secret');
        $this->assertStringNotContainsString($data['secret'], $raw);
        $this->assertSame($data['secret'], Crypt::decryptString($raw));

        // Not active until confirmed: signing in still gives tokens.
        $this->login($this->owner)->assertOk()->assertJsonStructure(['data' => ['tokens']]);

        $this->asAdmin($headers, 'POST', '/api/admin/v1/me/two-factor/confirm', ['code' => '000000'])
            ->assertUnprocessable()->assertJsonValidationErrors('code');
        $codes = $this->asAdmin($headers, 'POST', '/api/admin/v1/me/two-factor/confirm', ['code' => $this->codeFor($this->owner)])
            ->assertOk()->assertJsonPath('data.admin.two_factor_enabled', true)->assertJsonMissingPath('data.tokens')
            ->json('data.recovery_codes');
        $this->assertCount(10, $codes);
        $this->assertCount(10, array_unique($codes));
        foreach ($codes as $code) {
            $this->assertMatchesRegularExpression('/^[a-z2-9]{5}-[a-z2-9]{5}$/', $code);
        }
        $stored = DB::table('admins')->where('id', $this->owner->id)->value('two_factor_recovery_codes');
        foreach ($codes as $code) {
            $this->assertStringNotContainsString($code, $stored);
            $this->assertStringNotContainsString(str_replace('-', '', $code), $stored);
        }
        $this->assertDatabaseHas('audit_log', ['action' => 'admin.two_factor_enabled', 'admin_id' => $this->owner->id]);
        $this->asAdmin($headers, 'POST', '/api/admin/v1/me/two-factor')->assertUnprocessable()->assertJsonValidationErrors('two_factor');
        $this->asAdmin($headers, 'GET', '/api/admin/v1/me')->assertJsonPath('data.two_factor.recovery_codes_left', 10);
    }

    public function test_sign_in_needs_the_code_and_a_code_never_works_twice(): void
    {
        $this->enrol($this->owner);

        $first = $this->login($this->owner)->assertOk()->assertJsonPath('data.two_factor_required', true)
            ->assertJsonMissingPath('data.tokens')->assertJsonMissingPath('data.admin')->json('data');
        $this->assertSame(64, strlen($first['challenge']));
        $this->assertSame(now()->addMinutes(5)->toIso8601ZuluString(), $first['expires_at']);
        $this->assertTrue($this->owner->fresh()->last_login_at->lt(now())); // not updated by the password alone

        $code = $this->codeFor($this->owner);
        $this->secondStep($first['challenge'], ['code' => $code, 'remember' => true])->assertOk()
            ->assertJsonPath('data.admin.email', 'owner@example.com')
            ->assertJsonPath('data.tokens.remember', true)->assertJsonPath('data.tokens.scope', 'full');
        $this->assertTrue($this->owner->fresh()->last_login_at->eq(now()));
        $this->assertDatabaseHas('audit_log', ['action' => 'admin.signed_in', 'summary' => 'owner@example.com signed in with two-step sign-in.']);

        // The challenge worked once.
        $this->secondStep($first['challenge'], ['code' => $code])->assertUnprocessable()
            ->assertJsonValidationErrors(['challenge' => 'This sign-in has expired. Please sign in again.']);

        // Replay guard: the same code (still inside its window) on a new challenge is refused, and so is the step before.
        $second = $this->login($this->owner)->json('data.challenge');
        $this->secondStep($second, ['code' => $code])->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->secondStep($second, ['code' => $this->codeFor($this->owner, -1)])->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->travel(30)->seconds();
        $this->secondStep($second, ['code' => $this->codeFor($this->owner)])->assertOk();

        $this->secondStep('nope', ['code' => '123456'])->assertUnprocessable()->assertJsonValidationErrors('challenge');
        $this->secondStep($second, [])->assertUnprocessable()
            ->assertJsonValidationErrors(['code' => 'Enter the 6-digit code from your authenticator app.']);
    }

    public function test_a_challenge_expires_after_5_minutes_and_burns_after_5_wrong_codes(): void
    {
        $this->enrol($this->owner);

        $challenge = $this->login($this->owner)->json('data.challenge');
        $this->travel(5)->minutes();
        $this->travel(1)->seconds();
        $this->secondStep($challenge, ['code' => $this->codeFor($this->owner)])->assertUnprocessable()->assertJsonValidationErrors('challenge');

        $challenge = $this->login($this->owner)->json('data.challenge');
        $wrong = $this->codeFor($this->owner) === '111111' ? '222222' : '111111';
        for ($i = 1; $i <= 4; $i++) {
            $this->secondStep($challenge, ['code' => $wrong])->assertUnprocessable()
                ->assertJsonValidationErrors(['code' => 'That code isn\'t right. Check your authenticator app and try again.']);
        }
        $this->secondStep($challenge, ['code' => $wrong])->assertUnprocessable()
            ->assertJsonValidationErrors(['challenge' => 'Too many wrong codes. Please sign in again.']);
        $this->secondStep($challenge, ['code' => $this->codeFor($this->owner)])->assertUnprocessable()->assertJsonValidationErrors('challenge');
        $this->assertSame(5, AuditLog::where('action', 'admin.two_factor_failed')->whereNull('admin_id')->where('subject_id', $this->owner->id)->count());
    }

    public function test_recovery_codes_work_once_and_can_be_regenerated(): void
    {
        [$headers, $codes] = $this->enrol($this->owner);

        $challenge = $this->login($this->owner)->json('data.challenge');
        $this->secondStep($challenge, ['recovery_code' => strtoupper(str_replace('-', '', $codes[0]))])->assertOk()
            ->assertJsonPath('data.admin.two_factor.recovery_codes_left', 9);
        $this->assertDatabaseHas('audit_log', ['action' => 'admin.signed_in', 'summary' => 'owner@example.com signed in with a recovery code.']);

        $challenge = $this->login($this->owner)->json('data.challenge');
        $this->secondStep($challenge, ['recovery_code' => $codes[0]])->assertUnprocessable()
            ->assertJsonValidationErrors(['recovery_code' => 'That recovery code isn\'t right or was already used.']);

        $this->asAdmin($headers, 'POST', '/api/admin/v1/me/two-factor/recovery-codes', ['password' => 'wrong'])
            ->assertUnprocessable()->assertJsonValidationErrors('password');
        $new = $this->asAdmin($headers, 'POST', '/api/admin/v1/me/two-factor/recovery-codes', ['password' => 'AdminPass123'])
            ->assertOk()->json('data.recovery_codes');
        $this->assertCount(10, $new);
        $this->assertDatabaseHas('audit_log', ['action' => 'admin.two_factor_recovery_codes_regenerated']);

        $this->secondStep($challenge, ['recovery_code' => $codes[1]])->assertUnprocessable(); // the old set is gone
        $this->secondStep($challenge, ['recovery_code' => $new[0]])->assertOk();
    }

    public function test_turning_it_off_needs_the_password_and_a_code(): void
    {
        [$headers, $codes] = $this->enrol($this->owner);

        $this->asAdmin($headers, 'DELETE', '/api/admin/v1/me/two-factor', ['password' => 'wrong', 'code' => $this->codeFor($this->owner)])
            ->assertUnprocessable()->assertJsonValidationErrors('password');
        $this->asAdmin($headers, 'DELETE', '/api/admin/v1/me/two-factor', ['password' => 'AdminPass123', 'code' => 'zzzzz-zzzzz'])
            ->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->asAdmin($headers, 'DELETE', '/api/admin/v1/me/two-factor', ['password' => 'AdminPass123', 'code' => $codes[3]])
            ->assertOk()->assertJsonPath('message', 'Two-step sign-in is off.')->assertJsonPath('data.two_factor_enabled', false);

        $fresh = $this->owner->fresh();
        $this->assertNull($fresh->two_factor_secret);
        $this->assertNull($fresh->two_factor_recovery_codes);
        $this->assertDatabaseHas('audit_log', ['action' => 'admin.two_factor_disabled']);
        $this->login($this->owner)->assertOk()->assertJsonStructure(['data' => ['admin', 'tokens']]);
    }

    public function test_a_deactivated_admin_cannot_finish_the_second_step(): void
    {
        $staff = Admin::factory()->role('Sales staff')->create();
        $this->enrol($staff);
        $challenge = $this->login($staff)->json('data.challenge');
        $staff->forceFill(['is_active' => false])->save();

        $this->secondStep($challenge, ['code' => $this->codeFor($staff)])->assertForbidden()->assertJsonPath('code', 'account_disabled');
    }

    public function test_only_an_owner_with_two_step_can_require_it(): void
    {
        $manager = Admin::factory()->role(['settings.view', 'settings.edit'])->create();
        $this->asAdmin($this->signInAdmin($manager), 'PATCH', '/api/admin/v1/settings', ['security' => ['require_admin_two_factor' => true]])
            ->assertForbidden()->assertExactJson(['message' => 'Only an Owner can change security settings.', 'code' => 'owner_only']);
        // Other groups still work for them.
        $this->asAdmin($this->signInAdmin($manager), 'PATCH', '/api/admin/v1/settings', ['inventory' => ['low_stock_threshold' => 5]])->assertOk();

        $headers = $this->signInAdmin($this->owner);
        $this->asAdmin($headers, 'GET', '/api/admin/v1/settings')->assertOk()->assertJsonPath('data.security.require_admin_two_factor', false);
        $this->asAdmin($headers, 'PATCH', '/api/admin/v1/settings', ['security' => ['require_admin_two_factor' => true]])
            ->assertUnprocessable()->assertJsonValidationErrors(['security.require_admin_two_factor' => 'Turn on two-step sign-in for your own account first.']);

        [$headers] = $this->enrol($this->owner);
        $this->asAdmin($headers, 'PATCH', '/api/admin/v1/settings', ['security' => ['require_admin_two_factor' => true]])
            ->assertOk()->assertJsonPath('data.security.require_admin_two_factor', true);
        $this->asAdmin($headers, 'DELETE', '/api/admin/v1/me/two-factor', ['password' => 'AdminPass123', 'code' => $this->codeFor($this->owner)])
            ->assertUnprocessable()->assertJsonValidationErrors(['two_factor' => 'The store requires two-step sign-in for every admin, so you can\'t turn it off.']);
    }

    public function test_forced_enrolment_gives_a_limited_token_that_only_reaches_the_setup(): void
    {
        $staff = Admin::factory()->role('Sales staff')->create(['email' => 'staff@example.com']);
        $oldHeaders = $this->signInAdmin($staff); // signed in before the rule
        [$ownerHeaders] = $this->enrol($this->owner);
        $this->asAdmin($ownerHeaders, 'PATCH', '/api/admin/v1/settings', ['security' => ['require_admin_two_factor' => true]])->assertOk();

        // The full token of an admin without two-step now only reaches the setup.
        $this->asAdmin($oldHeaders, 'GET', '/api/admin/v1/orders')->assertForbidden()
            ->assertExactJson(['message' => 'Set up two-step sign-in to continue.', 'code' => 'two_factor_setup_required']);
        $this->asAdmin($oldHeaders, 'GET', '/api/admin/v1/me')->assertOk()->assertJsonPath('data.two_factor.required', true);

        $answer = $this->login($staff, remember: true)->assertOk()
            ->assertJsonPath('data.two_factor_setup_required', true)
            ->assertJsonPath('data.admin.email', 'staff@example.com')
            ->assertJsonPath('data.tokens.scope', 'two_factor_setup')->json('data');
        $limited = $this->bearer($answer['tokens']['access_token']);

        $this->asAdmin($limited, 'GET', '/api/admin/v1/me')->assertOk();
        foreach ([['GET', '/api/admin/v1/orders'], ['GET', '/api/admin/v1/overview'], ['GET', '/api/admin/v1/notifications'],
            ['POST', '/api/admin/v1/me/two-factor/recovery-codes'], ['DELETE', '/api/admin/v1/me/two-factor'], ['PATCH', '/api/admin/v1/settings']] as [$method, $uri]) {
            $this->asAdmin($limited, $method, $uri)->assertForbidden()->assertJsonPath('code', 'two_factor_setup_required');
        }

        // Refreshing keeps it limited until the setup is done.
        $this->app['auth']->forgetGuards();
        $refreshed = $this->postJson('/api/admin/v1/auth/refresh', ['refresh_token' => $answer['tokens']['refresh_token']])
            ->assertOk()->assertJsonPath('data.tokens.scope', 'two_factor_setup')->json('data.tokens');
        $limited = $this->bearer($refreshed['access_token']);
        $this->asAdmin($limited, 'GET', '/api/admin/v1/orders')->assertForbidden();

        $this->asAdmin($limited, 'POST', '/api/admin/v1/me/two-factor')->assertOk();
        $done = $this->asAdmin($limited, 'POST', '/api/admin/v1/me/two-factor/confirm', ['code' => $this->codeFor($staff)])->assertOk()
            ->assertJsonPath('data.tokens.scope', 'full')->assertJsonPath('data.tokens.remember', true)->json('data');
        $this->assertCount(10, $done['recovery_codes']);

        $this->asAdmin($limited, 'GET', '/api/admin/v1/me')->assertUnauthorized(); // the limited pair is signed out
        $this->asAdmin($this->bearer($done['tokens']['access_token']), 'GET', '/api/admin/v1/orders')->assertOk();
        $this->asAdmin($oldHeaders, 'GET', '/api/admin/v1/orders')->assertOk(); // now set up: the old session works again
    }

    public function test_the_owner_resets_another_admins_two_step_and_signs_them_out(): void
    {
        $staff = Admin::factory()->role('Sales staff')->create();
        [$staffHeaders] = $this->enrol($staff);
        $manager = Admin::factory()->role(['admins.manage'])->create();

        $this->asAdmin($this->signInAdmin($manager), 'POST', "/api/admin/v1/admins/{$staff->id}/two-factor/reset")
            ->assertForbidden()->assertJsonPath('code', 'owner_only');

        $ownerHeaders = $this->signInAdmin($this->owner);
        $this->asAdmin($ownerHeaders, 'POST', "/api/admin/v1/admins/{$this->owner->id}/two-factor/reset")
            ->assertUnprocessable()->assertJsonValidationErrors('two_factor');
        $this->asAdmin($ownerHeaders, 'POST', '/api/admin/v1/admins/999999/two-factor/reset')->assertNotFound();
        $this->asAdmin($ownerHeaders, 'POST', "/api/admin/v1/admins/{$staff->id}/two-factor/reset")->assertOk()
            ->assertJsonPath('data.two_factor_enabled', false);
        $this->asAdmin($ownerHeaders, 'POST', "/api/admin/v1/admins/{$staff->id}/two-factor/reset")
            ->assertUnprocessable()->assertJsonValidationErrors(['two_factor' => 'This admin doesn\'t use two-step sign-in.']);

        $this->asAdmin($staffHeaders, 'GET', '/api/admin/v1/me')->assertUnauthorized();
        $this->assertNull($staff->fresh()->two_factor_secret);
        $this->assertDatabaseHas('audit_log', ['action' => 'admin.two_factor_reset', 'subject_id' => $staff->id, 'admin_id' => $this->owner->id]);
        $this->login($staff)->assertOk()->assertJsonStructure(['data' => ['tokens']]);

        // The admin list shows who uses it.
        $this->asAdmin($ownerHeaders, 'GET', "/api/admin/v1/admins/{$staff->id}")->assertJsonPath('data.two_factor_enabled', false);
    }
}
