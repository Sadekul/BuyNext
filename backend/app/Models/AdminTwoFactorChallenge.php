<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Phase 9 (part A): the second step of an admin sign-in. Created when the
 * password was right and two-step sign-in is on; only a hash of the
 * challenge token is stored. 5 minutes, 5 wrong codes, used once.
 */
class AdminTwoFactorChallenge extends Model
{
    public const UPDATED_AT = null;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'used_at' => 'datetime', 'attempts' => 'integer'];
    }

    public function admin(): BelongsTo
    {
        return $this->belongsTo(Admin::class);
    }
}
