<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/**
 * Phase 11: a display currency. rate = units of this currency per 1 of the
 * base currency (typed in by staff). Prices are only shown converted; orders
 * are charged in the base currency.
 */
#[Fillable(['code', 'symbol', 'rate', 'decimals', 'enabled', 'position'])]
class CurrencyRate extends Model
{
    /** A rate older than this many days gets a warning in the admin. */
    public const STALE_DAYS = 30;

    protected function casts(): array
    {
        return [
            'rate' => 'decimal:8',
            'decimals' => 'integer',
            'enabled' => 'boolean',
            'position' => 'integer',
        ];
    }

    public function api(): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'symbol' => $this->symbol,
            'rate' => $this->rate,
            'decimals' => $this->decimals,
            'enabled' => $this->enabled,
            'position' => $this->position,
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
            'stale' => $this->updated_at !== null && $this->updated_at->lt(now()->subDays(self::STALE_DAYS)),
        ];
    }
}
