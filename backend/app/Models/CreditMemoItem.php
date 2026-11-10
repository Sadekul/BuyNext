<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One refunded line: how many units of an order item, and the money for them. */
#[Fillable(['credit_memo_id', 'order_item_id', 'quantity', 'amount'])]
class CreditMemoItem extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return ['quantity' => 'integer', 'amount' => 'decimal:2'];
    }

    public function orderItem(): BelongsTo
    {
        return $this->belongsTo(OrderItem::class);
    }
}
