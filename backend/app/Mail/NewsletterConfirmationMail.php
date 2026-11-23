<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Support\EmailBlocks;
use App\Support\Locale;
use Illuminate\Mail\Mailable;

/** Phase 7: "Confirm your newsletter subscription" with the double opt-in link (template newsletter_confirmation). */
class NewsletterConfirmationMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public string $token)
    {
        $this->locale(Locale::current()); // phase 13: the language of the store request that sends it
    }

    public function confirmUrl(): string
    {
        return config('buynest.storefront_url').'/newsletter/confirm?token='.urlencode($this->token);
    }

    protected function templateKey(): string
    {
        return 'newsletter_confirmation';
    }

    protected function templateValues(): array
    {
        return [
            'confirm_url' => $this->confirmUrl(),
            'button' => EmailBlocks::button($this->confirmUrl(), __('Confirm subscription')),
        ];
    }
}
