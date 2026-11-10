<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\OneTimeCode;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

class PasswordResetTest extends TestCase
{
    use ReadsCodes, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Customer::factory()->create(['email' => 'ava@example.com']);
    }

    public function test_forgot_password_answers_the_same_for_unknown_emails(): void
    {
        $known = $this->postJson('/api/v1/auth/forgot-password', ['email' => 'ava@example.com'])->assertOk();
        $unknown = $this->postJson('/api/v1/auth/forgot-password', ['email' => 'nobody@example.com'])->assertOk();

        $this->assertSame(
            str_replace('ava@example.com', 'X', $known->json('message')),
            str_replace('nobody@example.com', 'X', $unknown->json('message')),
        );
        Mail::assertSentCount(1);
    }

    public function test_the_emailed_code_sets_a_new_password_and_signs_out_everywhere(): void
    {
        $old = $this->postJson('/api/v1/auth/login', ['email' => 'ava@example.com', 'password' => 'Password123'])->json('data.tokens');
        $this->postJson('/api/v1/auth/forgot-password', ['email' => 'ava@example.com']);
        $code = $this->lastCodeFor('ava@example.com', OneTimeCode::RESET_PASSWORD);

        $this->postJson('/api/v1/auth/reset-password', [
            'email' => 'ava@example.com', 'code' => $code, 'password' => 'BrandNew99', 'password_confirmation' => 'BrandNew99',
        ])->assertOk();

        $this->getJson('/api/v1/me', $this->bearer($old['access_token']))->assertUnauthorized();
        $this->postJson('/api/v1/auth/login', ['email' => 'ava@example.com', 'password' => 'Password123'])->assertUnprocessable();
        $this->postJson('/api/v1/auth/login', ['email' => 'ava@example.com', 'password' => 'BrandNew99'])->assertOk();
    }

    public function test_a_wrong_code_or_a_sign_up_code_cannot_reset_the_password(): void
    {
        $this->postJson('/api/v1/auth/reset-password', [
            'email' => 'ava@example.com', 'code' => '000000', 'password' => 'BrandNew99', 'password_confirmation' => 'BrandNew99',
        ])->assertJsonValidationErrors('code');

        // A code for another purpose (email verification) doesn't work here.
        Customer::sole()->forceFill(['email_verified_at' => null])->save();
        $this->postJson('/api/v1/auth/resend-code', ['email' => 'ava@example.com', 'purpose' => 'verify_email']);
        $verifyCode = $this->lastCodeFor('ava@example.com', OneTimeCode::VERIFY_EMAIL);
        $this->postJson('/api/v1/auth/reset-password', [
            'email' => 'ava@example.com', 'code' => $verifyCode, 'password' => 'BrandNew99', 'password_confirmation' => 'BrandNew99',
        ])->assertJsonValidationErrors('code');
    }

    public function test_reset_requires_a_strong_password(): void
    {
        $this->postJson('/api/v1/auth/forgot-password', ['email' => 'ava@example.com']);
        $this->postJson('/api/v1/auth/reset-password', [
            'email' => 'ava@example.com', 'code' => $this->lastCodeFor('ava@example.com'), 'password' => 'weak', 'password_confirmation' => 'weak',
        ])->assertJsonValidationErrors('password');
    }
}
