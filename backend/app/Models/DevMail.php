<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** An email recorded by the local test inbox (see AppServiceProvider). */
class DevMail extends Model
{
    protected $table = 'dev_mailbox';

    public const UPDATED_AT = null;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['created_at' => 'datetime', 'headers' => 'array'];
    }
}
