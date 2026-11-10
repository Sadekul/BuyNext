<?php

namespace App\Mail;

use App\Models\OneTimeCode;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/** The email with a 6-digit code (sign-up verification or password reset). */
class OneTimeCodeMail extends Mailable
{
    public function __construct(public string $code, public string $purpose, public string $firstName) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->purpose === OneTimeCode::RESET_PASSWORD
            ? 'Reset your BuyNest password'
            : 'Confirm your email for BuyNest');
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.one-time-code',
            text: 'emails.one-time-code-text',
            with: [
                'heading' => $this->purpose === OneTimeCode::RESET_PASSWORD ? 'Reset your password' : 'Confirm your email',
                'intro' => $this->purpose === OneTimeCode::RESET_PASSWORD
                    ? 'Use this code to choose a new password for your BuyNest account.'
                    : 'Welcome to BuyNest! Enter this code to finish creating your account.',
                'minutes' => config('buynest.codes.ttl_minutes'),
            ],
        );
    }
}
