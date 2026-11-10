<?php

namespace Tests\Feature\Concerns;

use App\Mail\OneTimeCodeMail;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;

trait ReadsCodes
{
    /** The code in the newest email sent to $email (needs Mail::fake()). */
    protected function lastCodeFor(string $email, ?string $purpose = null): string
    {
        $mails = Mail::sent(OneTimeCodeMail::class, fn ($mail) => $mail->hasTo($email) && ($purpose === null || $mail->purpose === $purpose));
        $this->assertNotEmpty($mails, "No code was emailed to {$email}");

        return $mails->last()->code;
    }

    protected function signUp(array $overrides = []): TestResponse
    {
        return $this->postJson('/api/v1/auth/register', array_merge([
            'first_name' => 'Nadia',
            'last_name' => 'Rahman',
            'email' => 'nadia@example.com',
            'phone' => '+880 1712-345678',
            'password' => 'Secret123',
            'password_confirmation' => 'Secret123',
            'accept_terms' => true,
        ], $overrides));
    }

    protected function bearer(string $token): array
    {
        return ['Authorization' => "Bearer {$token}"];
    }
}
