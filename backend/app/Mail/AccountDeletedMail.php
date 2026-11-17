<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use Illuminate\Mail\Mailable;

/** Phase 9 (part A): the customer deleted their own account (template account_deleted). */
class AccountDeletedMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public string $firstName) {}

    protected function templateKey(): string
    {
        return 'account_deleted';
    }

    protected function templateValues(): array
    {
        return ['customer_first_name' => $this->firstName];
    }
}
