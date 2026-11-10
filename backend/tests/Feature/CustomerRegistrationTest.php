<?php

namespace Tests\Feature;

use App\Mail\OneTimeCodeMail;
use App\Models\Customer;
use App\Models\OneTimeCode;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

class CustomerRegistrationTest extends TestCase
{
    use ReadsCodes, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
    }

    public function test_sign_up_creates_an_unverified_customer_and_emails_a_code(): void
    {
        $this->signUp(['email' => ' Nadia@Example.com '])
            ->assertCreated()
            ->assertJsonPath('data.email', 'nadia@example.com')
            ->assertJsonPath('data.expires_in', 600)
            ->assertJsonMissingPath('data.tokens');

        $customer = Customer::sole();
        $this->assertSame('nadia@example.com', $customer->email);
        $this->assertSame('+8801712345678', $customer->phone, 'phone stored in international form');
        $this->assertNull($customer->email_verified_at);
        $this->assertNotSame('Secret123', $customer->password, 'password is hashed');

        $code = $this->lastCodeFor('nadia@example.com');
        $this->assertMatchesRegularExpression('/^\d{6}$/', $code);
        $this->assertNotSame($code, OneTimeCode::sole()->code_hash, 'only a hash of the code is stored');
    }

    public function test_sign_up_validates_every_field(): void
    {
        $this->signUp([
            'first_name' => '',
            'email' => 'not-an-email',
            'phone' => '12',
            'password' => 'short',
            'password_confirmation' => 'different',
            'accept_terms' => false,
        ])->assertUnprocessable()->assertJsonValidationErrors(['first_name', 'email', 'phone', 'password', 'accept_terms']);

        $this->signUp(['password' => 'lettersonly', 'password_confirmation' => 'lettersonly'])->assertJsonValidationErrors('password');
        $this->assertDatabaseCount('customers', 0);
        Mail::assertNothingSent();
    }

    public function test_an_email_with_a_verified_account_cannot_sign_up_again(): void
    {
        Customer::factory()->create(['email' => 'nadia@example.com']);

        $this->signUp()->assertUnprocessable()->assertJsonValidationErrors('email');
        Mail::assertNothingSent();
    }

    public function test_signing_up_again_before_verifying_replaces_the_details(): void
    {
        $this->signUp(['first_name' => 'Typo']);
        $this->travel(61)->seconds();
        $this->signUp(['first_name' => 'Nadia', 'password' => 'NewSecret9', 'password_confirmation' => 'NewSecret9'])->assertCreated();

        $this->assertDatabaseCount('customers', 1);
        $this->assertSame('Nadia', Customer::sole()->first_name);
    }

    public function test_the_right_code_verifies_the_email_and_signs_the_customer_in(): void
    {
        $this->signUp();
        $code = $this->lastCodeFor('nadia@example.com');

        $response = $this->postJson('/api/v1/auth/verify-email', ['email' => 'nadia@example.com', 'code' => $code])
            ->assertOk()
            ->assertJsonPath('data.customer.email_verified', true)
            ->assertJsonPath('data.customer.phone', '+8801712345678')
            ->assertJsonMissingPath('data.customer.password');

        $this->assertNotNull(Customer::sole()->email_verified_at);
        $this->getJson('/api/v1/me', $this->bearer($response->json('data.tokens.access_token')))->assertOk();

        // A code works once.
        $this->postJson('/api/v1/auth/verify-email', ['email' => 'nadia@example.com', 'code' => $code])->assertJsonValidationErrors('code');
    }

    public function test_wrong_codes_are_refused_and_five_lock_the_code(): void
    {
        $this->signUp();
        $code = $this->lastCodeFor('nadia@example.com');
        $wrong = str_pad((string) (((int) $code + 1) % 1000000), 6, '0', STR_PAD_LEFT);

        for ($i = 1; $i <= 4; $i++) {
            $this->postJson('/api/v1/auth/verify-email', ['email' => 'nadia@example.com', 'code' => $wrong])
                ->assertJsonValidationErrors(['code' => 'incorrect']);
        }
        $this->postJson('/api/v1/auth/verify-email', ['email' => 'nadia@example.com', 'code' => $wrong])
            ->assertJsonValidationErrors(['code' => 'Too many']);
        // Even the right code no longer works: a new one is needed.
        $this->postJson('/api/v1/auth/verify-email', ['email' => 'nadia@example.com', 'code' => $code])
            ->assertJsonValidationErrors(['code' => 'Too many']);
        $this->assertNull(Customer::sole()->email_verified_at);
    }

    public function test_codes_expire_after_ten_minutes(): void
    {
        $this->signUp();
        $code = $this->lastCodeFor('nadia@example.com');
        $this->travel(11)->minutes();

        $this->postJson('/api/v1/auth/verify-email', ['email' => 'nadia@example.com', 'code' => $code])
            ->assertJsonValidationErrors(['code' => 'expired']);
    }

    public function test_resending_waits_a_minute_and_replaces_the_old_code(): void
    {
        $this->signUp();
        $first = $this->lastCodeFor('nadia@example.com');

        $this->postJson('/api/v1/auth/resend-code', ['email' => 'nadia@example.com', 'purpose' => 'verify_email'])
            ->assertOk()->assertJsonPath('data.resend_in', fn ($seconds) => $seconds > 0 && $seconds <= 60);
        Mail::assertSentCount(1);

        $this->travel(61)->seconds();
        $this->postJson('/api/v1/auth/resend-code', ['email' => 'nadia@example.com', 'purpose' => 'verify_email'])->assertOk();
        Mail::assertSentCount(2);
        $second = $this->lastCodeFor('nadia@example.com');

        if ($first !== $second) {
            $this->postJson('/api/v1/auth/verify-email', ['email' => 'nadia@example.com', 'code' => $first])->assertJsonValidationErrors('code');
        }
        $this->postJson('/api/v1/auth/verify-email', ['email' => 'nadia@example.com', 'code' => $second])->assertOk();
    }

    public function test_resend_does_not_reveal_whether_an_account_exists(): void
    {
        $unknown = $this->postJson('/api/v1/auth/resend-code', ['email' => 'nobody@example.com', 'purpose' => 'verify_email'])->assertOk();
        $this->signUp();
        $this->travel(61)->seconds();
        $known = $this->postJson('/api/v1/auth/resend-code', ['email' => 'nadia@example.com', 'purpose' => 'verify_email'])->assertOk();

        $this->assertSame($unknown->json('message'), $known->json('message'));
        Mail::assertSent(OneTimeCodeMail::class, fn ($mail) => ! $mail->hasTo('nobody@example.com'));
    }

    public function test_an_unverified_customer_cannot_sign_in_and_gets_a_new_code(): void
    {
        $this->signUp();
        $this->travel(61)->seconds();

        $this->postJson('/api/v1/auth/login', ['email' => 'nadia@example.com', 'password' => 'Secret123'])
            ->assertForbidden()
            ->assertJsonPath('code', 'email_unverified')
            ->assertJsonMissingPath('data.tokens');
        Mail::assertSentCount(2);
    }

    public function test_unverified_sign_ups_are_pruned_after_a_week(): void
    {
        $this->signUp();
        Customer::factory()->create(['created_at' => now()->subDays(30)]);
        $this->travel(8)->days();

        $this->artisan('model:prune', ['--model' => [Customer::class]]);
        $this->assertDatabaseCount('customers', 1);
        $this->assertNotNull(Customer::sole()->email_verified_at);
    }
}
