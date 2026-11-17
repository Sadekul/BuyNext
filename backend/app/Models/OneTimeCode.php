<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OneTimeCode extends Model
{
    public const VERIFY_EMAIL = 'verify_email';

    public const RESET_PASSWORD = 'reset_password';

    /** Phase 9 (part A): sent to the NEW address when a customer changes their email. */
    public const EMAIL_CHANGE = 'email_change';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'consumed_at' => 'datetime'];
    }
}
