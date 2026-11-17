<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\BackupRun;
use App\Services\Audit;
use App\Services\BackupAlreadyRunning;
use App\Services\Backups;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\URL;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

/**
 * Phase 9 (part B): System → Backups (backups.view, Owner only by default).
 * Lists the backups, makes one now, and downloads one through a link that is
 * signed and valid for 5 minutes (and still needs the admin's sign-in).
 * Restoring is a documented procedure (docs/DEPLOY_RAILWAY.md), not a button.
 */
class BackupController extends Controller
{
    public const LINK_MINUTES = 5;

    public function __construct(private Backups $backups, private Audit $audit) {}

    /** GET /api/admin/v1/backups */
    public function index(): JsonResponse
    {
        $last = BackupRun::with('admin')->orderByDesc('id')->first();

        return response()->json([
            'data' => $this->backups->list(),
            'meta' => [
                'disk' => config('buynest.backups.disk'),
                'keep_days' => (int) config('buynest.backups.keep_days'),
                'schedule' => config('buynest.backups.schedule') ? config('buynest.backups.time') : null,
                'timezone' => config('buynest.backups.timezone'),
                'running' => $this->backups->running(),
                'last_run' => $last?->toItem(),
            ],
        ]);
    }

    /** POST /api/admin/v1/backups - "Back up now" (waits for it, up to the backup timeout). */
    public function store(Request $request): JsonResponse
    {
        @set_time_limit((int) config('buynest.backups.timeout_seconds') + 60);
        try {
            $run = $this->backups->run('admin', $request->user());
        } catch (BackupAlreadyRunning $e) {
            throw ValidationException::withMessages(['backup' => $e->getMessage()]);
        }
        $run->load('admin');
        if ($run->status !== 'ok') {
            throw ValidationException::withMessages(['backup' => "The backup failed: {$run->error}"]);
        }
        $this->audit->record('backup.created', "Database backup {$run->file_name} made.", 'backup', $run->id);

        return response()->json(['data' => $run->toItem()], 201);
    }

    /** POST /api/admin/v1/backups/{name}/link → { url (relative, signed), expires_at } */
    public function link(string $name): JsonResponse
    {
        if (! $this->backups->exists($name)) {
            return $this->notFound();
        }
        $expires = now()->addMinutes(self::LINK_MINUTES);
        $url = URL::temporarySignedRoute('admin.backups.download', $expires, ['name' => $name], absolute: false);

        return response()->json(['data' => ['url' => $url, 'expires_at' => $expires->toIso8601ZuluString()]]);
    }

    /** GET /api/admin/v1/backups/{name}/download?expires&signature → the .sql.gz file */
    public function download(Request $request, string $name): Response
    {
        if (! $request->hasValidRelativeSignature()) {
            return response()->json(['message' => 'This download link has expired. Create a new one.'], 403);
        }
        if (! $this->backups->exists($name)) {
            return $this->notFound();
        }
        $this->audit->record('backup.downloaded', "Database backup {$name} downloaded.", 'backup', null, ['before' => [], 'after' => ['file' => $name]]);

        return $this->backups->disk()->download($name, $name, [
            'Content-Type' => 'application/gzip',
            'Cache-Control' => 'no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Backup not found.'], 404);
    }
}
