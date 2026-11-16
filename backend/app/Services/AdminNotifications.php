<?php

namespace App\Services;

use App\Models\Admin;
use App\Models\AdminNotification;
use Illuminate\Support\Carbon;

/**
 * Phase 7: creates entries for the admin notification bell (low stock, new
 * return requests, reviews waiting, failed newsletter batches).
 *
 * No duplicates: a notification of the same type for the same subject
 * ("product:12") isn't created again while no admin has read the previous
 * one. (Two requests at the very same moment could both add one; that's
 * harmless, and a lock here would slow down checkout, which calls this.)
 */
class AdminNotifications
{
    public const TYPES = [
        'low_stock' => ['warning', 'products.view'],
        'out_of_stock' => ['critical', 'products.view'],
        'return_requested' => ['info', 'returns.view'],
        'review_pending' => ['info', 'reviews.view'],
        'newsletter_failed' => ['critical', 'newsletter.send'],
    ];

    /** Returns the new notification, or null when an unread one for the same subject exists. */
    public function notify(string $type, string $subjectKey, string $title, string $body = '', ?string $link = null): ?AdminNotification
    {
        [$severity, $permission] = self::TYPES[$type];

        $unread = AdminNotification::where('type', $type)->where('subject_key', $subjectKey)
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('admin_notification_reads')->whereColumn('notification_id', 'admin_notifications.id'))
            ->exists();
        if ($unread) {
            return null;
        }

        return AdminNotification::create([
            'type' => $type,
            'severity' => $severity,
            'title' => mb_substr($title, 0, 190),
            'body' => mb_substr($body, 0, 1000),
            'link' => $link,
            'permission' => $permission,
            'subject_key' => $subjectKey,
        ]);
    }

    /** How many notifications $admin may see and hasn't read. */
    public function unreadCount(Admin $admin): int
    {
        return AdminNotification::visibleTo($admin)->unreadBy($admin)->count();
    }

    /** The JSON item: { id, type, severity, title, body, link, created_at, read_at }. */
    public static function item(AdminNotification $notification): array
    {
        $readAt = $notification->getAttribute('read_at');

        return [
            'id' => $notification->id,
            'type' => $notification->type,
            'severity' => $notification->severity,
            'title' => $notification->title,
            'body' => $notification->body,
            'link' => $notification->link,
            'created_at' => $notification->created_at?->toIso8601ZuluString(),
            'read_at' => $readAt ? Carbon::parse($readAt)->toIso8601ZuluString() : null,
        ];
    }
}
