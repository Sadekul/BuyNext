<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\OneTimeCode;
use App\Support\Locale;
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
    /** $email (phase 9): the address the code goes to (the new address of an email change). */
    public function __construct(public string $code, public string $purpose, public string $firstName, public bool $setPassword = false,
        public ?string $email = null, ?string $locale = null)
    {
        // Phase 13: the language given (a staff-sent code: the customer's), otherwise the language of the request that sends it.
        $this->locale($locale ?? Locale::current());
    }

    protected function templateKey(): string
    {
        return match (true) {
            $this->setPassword => 'set_password',
            $this->purpose === OneTimeCode::EMAIL_CHANGE => 'email_change_code', // phase 9 (part A)
            $this->purpose === OneTimeCode::RESET_PASSWORD => 'password_reset',
            default => 'email_verification',
        };
    }

    protected function templateValues(): array
    {
        return [
            'customer_first_name' => $this->firstName,
            'code' => $this->code,
            'expires_minutes' => Locale::digits((string) config('buynest.codes.ttl_minutes')),
            ...($this->purpose === OneTimeCode::EMAIL_CHANGE ? ['new_email' => (string) $this->email] : []),
        ];
    }
}
