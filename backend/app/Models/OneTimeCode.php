<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OneTimeCode extends Model
{
    public const VERIFY_EMAIL = 'verify_email';

    public const RESET_PASSWORD = 'reset_password';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'consumed_at' => 'datetime'];
    }
}
