<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One step in an order's life (placed, paid, shipped...). admin_id says which
 * staff member did it (null for the checkout itself). A note counts as
 * internal unless the customer was notified about that step.
 */
#[Fillable(['order_id', 'status', 'payment_status', 'note', 'admin_id', 'customer_notified'])]
class OrderStatusHistory extends Model
{
    protected $table = 'order_status_history';

    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return ['customer_notified' => 'boolean'];
    }

    public function admin(): BelongsTo
    {
        return $this->belongsTo(Admin::class);
    }
}
