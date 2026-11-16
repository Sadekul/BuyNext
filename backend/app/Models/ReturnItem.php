<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One returned order line: how many units, and their condition once received. */
#[Fillable(['return_id', 'order_item_id', 'quantity', 'condition'])]
class ReturnItem extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return ['quantity' => 'integer'];
    }

    public function orderItem(): BelongsTo
    {
        return $this->belongsTo(OrderItem::class);
    }

    public function orderReturn(): BelongsTo
    {
        return $this->belongsTo(OrderReturn::class, 'return_id');
    }
}
