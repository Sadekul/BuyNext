<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/** Phase 7: one admin's saved grid settings (columns, page size, saved filters). */
#[Fillable(['admin_id', 'key', 'value'])]
class AdminPreference extends Model
{
    public const KEYS = ['products_grid', 'orders_grid', 'customers_grid'];

    protected function casts(): array
    {
        return ['value' => 'array'];
    }
}
