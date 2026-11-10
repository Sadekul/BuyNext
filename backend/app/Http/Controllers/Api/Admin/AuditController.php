<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AuditEntryResource;
use App\Models\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/** GET /api/admin/v1/audit - the audit log, newest first. */
class AuditController extends Controller
{
    /**
     * ?admin_id&action&subject_type&subject_id&from&to&page&per_page
     * action: an exact action ("product.updated") or a whole area ("product").
     * from / to: dates (YYYY-MM-DD, inclusive, UTC).
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'admin_id' => ['nullable', 'integer'],
            'action' => ['nullable', 'string', 'max:60'],
            'subject_type' => ['nullable', 'string', 'max:40'],
            'subject_id' => ['nullable', 'integer'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $entries = AuditLog::with('admin')
            ->when($data['admin_id'] ?? null, fn ($q, $id) => $q->where('admin_id', $id))
            ->when($data['action'] ?? null, fn ($q, $action) => str_contains($action, '.')
                ? $q->where('action', $action)
                : $q->where('action', 'like', addcslashes($action, '%_\\').'.%'))
            ->when($data['subject_type'] ?? null, fn ($q, $type) => $q->where('subject_type', $type))
            ->when($data['subject_id'] ?? null, fn ($q, $id) => $q->where('subject_id', $id))
            ->when($data['from'] ?? null, fn ($q, $from) => $q->where('created_at', '>=', "{$from} 00:00:00"))
            ->when($data['to'] ?? null, fn ($q, $to) => $q->where('created_at', '<=', "{$to} 23:59:59"))
            ->latest('id')
            ->paginate($data['per_page'] ?? 50)
            ->withQueryString();

        return AuditEntryResource::collection($entries);
    }
}
