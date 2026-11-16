<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Phase 7: one entry in the admin's notification bell. `permission` is the
 * key an admin needs to see it; reads are per admin (admin_notification_reads).
 */
#[Fillable(['type', 'severity', 'title', 'body', 'link', 'permission', 'subject_key'])]
class AdminNotification extends Model
{
    public const UPDATED_AT = null;

    public const SEVERITIES = ['info', 'warning', 'critical'];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    /** Only the notifications $admin's role lets them see (Owner: all). */
    public function scopeVisibleTo(Builder $query, Admin $admin): void
    {
        if (! $admin->isOwner()) {
            $query->whereIn('permission', $admin->permissions());
        }
    }

    /** Adds read_at (this admin's read time, or null). */
    public function scopeWithReadAt(Builder $query, Admin $admin): void
    {
        $query->addSelect(['read_at' => fn ($q) => $q->select('read_at')->from('admin_notification_reads')
            ->whereColumn('notification_id', 'admin_notifications.id')->where('admin_id', $admin->id)->limit(1)]);
    }

    public function scopeUnreadBy(Builder $query, Admin $admin): void
    {
        $query->whereNotExists(fn ($q) => $q->selectRaw('1')->from('admin_notification_reads')
            ->whereColumn('notification_id', 'admin_notifications.id')->where('admin_id', $admin->id));
    }
}
