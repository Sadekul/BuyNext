<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Support\Locale;
use Illuminate\Mail\Mailable;

/** Phase 9 (part A): "Your BuyNest email was changed", sent to the OLD address (template email_changed). */
class EmailChangedMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public string $firstName, public string $oldEmail, public string $newEmail)
    {
        $this->locale(Locale::current()); // phase 13: the language of the store request that sends it
    }

    protected function templateKey(): string
    {
        return 'email_changed';
    }

    protected function templateValues(): array
    {
        return ['customer_first_name' => $this->firstName, 'old_email' => $this->oldEmail, 'new_email' => $this->newEmail];
    }
}
