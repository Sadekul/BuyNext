<?php

namespace App\Mail;

use App\Models\OneTimeCode;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/** The email with a 6-digit code (sign-up verification or password reset). */
class OneTimeCodeMail extends Mailable
{
    /** $setPassword (phase 6): the same reset code, worded for an account staff created or a reset staff sent. */
    public function __construct(public string $code, public string $purpose, public string $firstName, public bool $setPassword = false) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: match (true) {
            $this->setPassword => 'Set your BuyNest password',
            $this->purpose === OneTimeCode::RESET_PASSWORD => 'Reset your BuyNest password',
            default => 'Confirm your email for BuyNest',
        });
    }

    public function content(): Content
    {
        if ($this->setPassword) {
            return new Content(
                view: 'emails.one-time-code',
                text: 'emails.one-time-code-text',
                with: [
                    'heading' => 'Set your password',
                    'intro' => 'BuyNest staff set up your account (or a password reset) for you. Use this code to choose your password: '
                        .'on the BuyNest sign-in page choose "Forgot password?" and enter this email address. If we send you another code, use the newest one.',
                    'minutes' => config('buynest.codes.ttl_minutes'),
                    'expiredHint' => 'If the code has expired, choose "Forgot password?" again to get a new one.',
                ],
            );
        }

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
