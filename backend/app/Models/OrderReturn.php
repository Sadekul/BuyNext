<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * A return (Magento's RMA), "RMA-100001". The class can't be called Return
 * (a PHP keyword); the table is `returns`.
 *
 *   requested → approved | rejected
 *   approved  → received
 *   received  → refunded (only by a credit memo for the return) | closed
 */
#[Fillable(['order_id', 'customer_id', 'status', 'reason', 'comment', 'admin_note', 'resolution', 'restocked', 'customer_notified', 'created_by_admin_id'])]
class OrderReturn extends Model
{
    protected $table = 'returns';

    public const STATUSES = ['requested', 'approved', 'rejected', 'received', 'refunded', 'closed'];

    public const TRANSITIONS = [
        'requested' => ['approved', 'rejected'],
        'approved' => ['received'],
        'received' => ['refunded', 'closed'],
        'rejected' => [],
        'refunded' => [],
        'closed' => [],
    ];

    /** Statuses whose items still count against what can be returned (everything but rejected). */
    public const COUNTED = ['requested', 'approved', 'received', 'refunded', 'closed'];

    public const RESOLUTIONS = ['refund', 'replace'];

    public const CONDITIONS = ['unopened', 'opened', 'damaged'];

    protected function casts(): array
    {
        return ['restocked' => 'boolean', 'customer_notified' => 'boolean'];
    }

    public static function numberFor(int $id): string
    {
        return 'RMA-'.(100000 + $id);
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(Admin::class, 'created_by_admin_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(ReturnItem::class, 'return_id')->orderBy('id');
    }

    public function creditMemo(): HasOne
    {
        return $this->hasOne(CreditMemo::class, 'return_id')->latestOfMany();
    }

    public function canMoveTo(string $status): bool
    {
        return in_array($status, self::TRANSITIONS[$this->status] ?? [], true);
    }

    public function isOpen(): bool
    {
        return in_array($this->status, ['requested', 'approved', 'received'], true);
    }
}
