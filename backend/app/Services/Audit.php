<?php

namespace App\Services;

use App\Models\Admin;
use App\Models\AuditLog;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Model;

/**
 * Writes the audit log: who (the signed-in admin), what (an action such as
 * "product.updated"), to what (subject type + id), a one-line summary, and
 * the fields that changed as { before: {...}, after: {...} }.
 *
 * Secrets never go in: password fields and tokens are dropped by name, and
 * nothing is logged for fields that didn't change.
 *
 * Call it inside the same DB transaction as the change, so a rolled-back
 * change leaves no entry behind.
 */
class Audit
{
    private const SECRET_FIELDS = ['password', 'password_confirmation', 'remember_token', 'token', 'tokens', 'access_token', 'refresh_token', 'secret'];

    /**
     * $admin: who did it; by default the signed-in admin. Pass $anonymous for
     * entries without one (a failed sign-in: nobody is signed in).
     */
    public function record(string $action, string $summary, ?string $subjectType = null, ?int $subjectId = null,
        ?array $changes = null, ?Admin $admin = null, bool $anonymous = false): AuditLog
    {
        $user = request()->user();
        $admin ??= $user instanceof Admin ? $user : null;

        return AuditLog::create([
            'admin_id' => $anonymous ? null : $admin?->id,
            'action' => $action,
            'subject_type' => $subjectType,
            'subject_id' => $subjectId,
            'summary' => mb_substr($summary, 0, 255),
            'changes' => $changes,
            'ip' => request()->ip(),
        ]);
    }

    /**
     * Only the fields whose value differs: { before: {field: old}, after: {field: new} },
     * or null when nothing changed. "9.99" and 9.99 count as the same value.
     */
    public static function diff(array $before, array $after): ?array
    {
        $changes = ['before' => [], 'after' => []];
        foreach (array_unique([...array_keys($before), ...array_keys($after)]) as $field) {
            if (in_array($field, self::SECRET_FIELDS, true)) {
                continue;
            }
            $old = self::plain($before[$field] ?? null);
            $new = self::plain($after[$field] ?? null);
            if (self::comparable($old) !== self::comparable($new)) {
                $changes['before'][$field] = $old;
                $changes['after'][$field] = $new;
            }
        }

        return $changes['after'] === [] && $changes['before'] === [] ? null : $changes;
    }

    /** For a new record: every field is "after". */
    public static function created(array $after): array
    {
        return ['before' => [], 'after' => self::withoutSecrets(array_map(self::plain(...), $after))];
    }

    /** For a deleted record: every field is "before". */
    public static function deleted(array $before): array
    {
        return ['before' => self::withoutSecrets(array_map(self::plain(...), $before)), 'after' => []];
    }

    /** The fields of a model that are worth logging (attributes, minus secrets and timestamps). */
    public static function fieldsOf(Model $model, array $only = []): array
    {
        $attributes = $only ? array_intersect_key($model->attributesToArray(), array_flip($only)) : $model->attributesToArray();
        unset($attributes['created_at'], $attributes['updated_at'], $attributes['deleted_at']);

        return self::withoutSecrets($attributes);
    }

    private static function withoutSecrets(array $fields): array
    {
        return array_diff_key($fields, array_flip(self::SECRET_FIELDS));
    }

    private static function plain(mixed $value): mixed
    {
        return $value instanceof DateTimeInterface ? $value->format(DATE_ATOM) : $value;
    }

    private static function comparable(mixed $value): string
    {
        return match (true) {
            is_array($value) => json_encode($value),
            is_bool($value) => $value ? 'true' : 'false',
            is_numeric($value) => (string) (float) $value,
            default => (string) $value,
        };
    }
}
