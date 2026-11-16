<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\OneTimeCode;
use Illuminate\Mail\Mailable;

/**
 * The email with a 6-digit code: sign-up verification (template
 * email_verification), password reset (password_reset), or, for an account
 * staff created or a reset staff sent, set_password.
 */
class OneTimeCodeMail extends Mailable
{
    use RendersEmailTemplate;

    /** $setPassword (phase 6): the same reset code, worded for an account staff created or a reset staff sent. */
    public function __construct(public string $code, public string $purpose, public string $firstName, public bool $setPassword = false) {}

    protected function templateKey(): string
    {
        return match (true) {
            $this->setPassword => 'set_password',
            $this->purpose === OneTimeCode::RESET_PASSWORD => 'password_reset',
            default => 'email_verification',
        };
    }

    protected function templateValues(): array
    {
        return [
            'customer_first_name' => $this->firstName,
            'code' => $this->code,
            'expires_minutes' => (string) config('buynest.codes.ttl_minutes'),
        ];
    }
}
