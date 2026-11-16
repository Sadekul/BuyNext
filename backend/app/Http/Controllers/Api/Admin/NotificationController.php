<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\AdminNotification;
use App\Services\AdminNotifications;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;

/**
 * Phase 7: the admin's notification bell. No permission key of its own:
 * every query is limited to the notifications whose `permission` the
 * admin's role grants (AdminNotification::visibleTo). Reads are per admin.
 */
class NotificationController extends Controller
{
    public function __construct(private AdminNotifications $notifications) {}

    /** GET /api/admin/v1/notifications?unread=1&page&per_page → newest first + meta.unread_count */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'unread' => ['nullable', 'boolean'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);
        $admin = $request->user();

        $page = AdminNotification::query()->select('admin_notifications.*')
            ->visibleTo($admin)->withReadAt($admin)
            ->when(filter_var($data['unread'] ?? false, FILTER_VALIDATE_BOOLEAN), fn ($q) => $q->unreadBy($admin))
            ->latest('id')->paginate($data['per_page'] ?? 20)->withQueryString()
            ->through(fn (AdminNotification $notification) => AdminNotifications::item($notification));

        return JsonResource::collection($page)->additional(['meta' => ['unread_count' => $this->notifications->unreadCount($admin)]]);
    }

    /** POST /api/admin/v1/notifications/{id}/read */
    public function read(Request $request, int $id): JsonResponse
    {
        $admin = $request->user();
        $notification = AdminNotification::visibleTo($admin)->find($id);
        if (! $notification) {
            return response()->json(['message' => 'Notification not found.'], 404);
        }
        DB::table('admin_notification_reads')->insertOrIgnore(['admin_id' => $admin->id, 'notification_id' => $notification->id, 'read_at' => now()]);

        $notification = AdminNotification::query()->select('admin_notifications.*')->withReadAt($admin)->find($id);

        return response()->json(['data' => AdminNotifications::item($notification)]);
    }

    /** POST /api/admin/v1/notifications/read-all */
    public function readAll(Request $request): JsonResponse
    {
        $admin = $request->user();
        $now = now();
        $rows = AdminNotification::visibleTo($admin)->unreadBy($admin)->pluck('id')
            ->map(fn ($id) => ['admin_id' => $admin->id, 'notification_id' => $id, 'read_at' => $now]);
        foreach ($rows->chunk(500) as $chunk) {
            DB::table('admin_notification_reads')->insertOrIgnore($chunk->values()->all());
        }

        return response()->json(['data' => ['marked' => $rows->count()], 'meta' => ['unread_count' => $this->notifications->unreadCount($admin)]]);
    }
}
