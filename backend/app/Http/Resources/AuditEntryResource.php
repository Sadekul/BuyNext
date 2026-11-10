<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** One audit log entry. admin is null for failed sign-ins. */
class AuditEntryResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'admin' => $this->admin ? ['id' => $this->admin->id, 'name' => $this->admin->name, 'email' => $this->admin->email] : null,
            'action' => $this->action,
            'subject_type' => $this->subject_type,
            'subject_id' => $this->subject_id,
            'summary' => $this->summary,
            // { before: {...}, after: {...} } or null. (object): an empty side is {} in JSON, not [].
            'changes' => $this->changes === null ? null : [
                'before' => (object) ($this->changes['before'] ?? []),
                'after' => (object) ($this->changes['after'] ?? []),
            ],
            'ip' => $this->ip,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}
