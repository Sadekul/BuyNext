<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\V1\SeoController;
use App\Http\Controllers\Controller;
use App\Models\UrlRedirect;
use App\Services\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Phase 7: Marketing → SEO → URL redirects (seo.manage). An old store
 * address (from_path) sends visitors to a new one (to_path) with 301
 * (moved for good) or 302 (for now). Paths are stored normalized
 * (UrlRedirect::normalize), and loops are refused.
 */
class UrlRedirectController extends Controller
{
    private const MAX_ROWS = 5000;

    public function __construct(private Audit $audit) {}

    /** GET /api/admin/v1/redirects?search&status_code&page&per_page (newest first) */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:255'],
            'status_code' => ['nullable', 'in:301,302'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $page = UrlRedirect::query()
            ->when($data['search'] ?? null, function ($q, $search) {
                $like = '%'.addcslashes(mb_strtolower($search), '%_\\').'%';
                $q->where(fn ($w) => $w->where('from_path', 'like', $like)->orWhere('to_path', 'like', $like));
            })
            ->when($data['status_code'] ?? null, fn ($q, $code) => $q->where('status_code', (int) $code))
            ->latest('id')->paginate($data['per_page'] ?? 50)->withQueryString()
            ->through(fn (UrlRedirect $redirect) => self::item($redirect));

        return JsonResource::collection($page);
    }

    /** GET /api/admin/v1/redirects/{id} */
    public function show(int $id): JsonResponse
    {
        $redirect = UrlRedirect::find($id);

        return $redirect ? response()->json(['data' => self::item($redirect)]) : $this->notFound();
    }

    /** POST /api/admin/v1/redirects { from_path, to_path, status_code? } → 201 */
    public function store(Request $request): JsonResponse
    {
        $data = $this->check($request->all(), null);
        $redirect = DB::transaction(function () use ($data) {
            $redirect = UrlRedirect::create($data);
            $this->audit->record('redirect.created', "Redirect {$redirect->from_path} → {$redirect->to_path} ({$redirect->status_code}) added.",
                'redirect', $redirect->id, Audit::created(Audit::fieldsOf($redirect, ['from_path', 'to_path', 'status_code'])));

            return $redirect;
        });
        SeoController::forgetRedirects();

        return response()->json(['data' => self::item($redirect->fresh())], 201);
    }

    /** PATCH /api/admin/v1/redirects/{id} - any of the fields. */
    public function update(Request $request, int $id): JsonResponse
    {
        $redirect = UrlRedirect::find($id);
        if (! $redirect) {
            return $this->notFound();
        }
        $data = $this->check([
            'from_path' => $redirect->from_path, 'to_path' => $redirect->to_path, 'status_code' => $redirect->status_code,
            ...$request->only(['from_path', 'to_path', 'status_code']),
        ], $redirect);

        DB::transaction(function () use ($redirect, $data) {
            $before = Audit::fieldsOf($redirect, ['from_path', 'to_path', 'status_code']);
            $redirect->fill($data)->save();
            if ($changes = Audit::diff($before, Audit::fieldsOf($redirect, ['from_path', 'to_path', 'status_code']))) {
                $this->audit->record('redirect.updated', "Redirect {$redirect->from_path} updated.", 'redirect', $redirect->id, $changes);
            }
        });
        SeoController::forgetRedirects();

        return response()->json(['data' => self::item($redirect->fresh())]);
    }

    /** DELETE /api/admin/v1/redirects/{id} → 204 */
    public function destroy(int $id): JsonResponse
    {
        $redirect = UrlRedirect::find($id);
        if (! $redirect) {
            return $this->notFound();
        }
        DB::transaction(function () use ($redirect) {
            $redirect->delete();
            $this->audit->record('redirect.deleted', "Redirect {$redirect->from_path} → {$redirect->to_path} deleted.", 'redirect', $redirect->id,
                Audit::deleted(Audit::fieldsOf($redirect, ['from_path', 'to_path', 'status_code'])));
        });
        SeoController::forgetRedirects();

        return response()->json(null, 204);
    }

    /**
     * POST /api/admin/v1/redirects/import (multipart: file) - a CSV with the
     * header from_path,to_path[,status_code]. An existing from_path is
     * updated; bad rows are skipped and listed.
     */
    public function import(Request $request): JsonResponse
    {
        $request->validate(['file' => ['required', 'file', 'max:2048']],
            ['file.required' => 'Choose a CSV file.', 'file.max' => 'The file can be at most 2 MB.']);
        $content = (string) file_get_contents($request->file('file')->getRealPath());
        $content = preg_replace('/^\xEF\xBB\xBF/', '', $content); // Excel's byte-order mark
        if (! mb_check_encoding($content, 'UTF-8')) {
            throw ValidationException::withMessages(['file' => 'Save the file as CSV UTF-8 and try again.']);
        }

        $stream = fopen('php://temp', 'r+');
        fwrite($stream, $content);
        rewind($stream);
        $header = array_map(fn ($cell) => mb_strtolower(trim((string) $cell)), fgetcsv($stream, escape: '') ?: []);
        if (! in_array('from_path', $header, true) || ! in_array('to_path', $header, true)) {
            throw ValidationException::withMessages(['file' => 'The first row must name the columns: from_path, to_path, and optionally status_code.']);
        }
        $rows = [];
        $line = 1;
        while (($cells = fgetcsv($stream, escape: '')) !== false) {
            $line++;
            if ($cells === [null] || implode('', $cells) === '') {
                continue;
            }
            if (count($rows) >= self::MAX_ROWS) {
                throw ValidationException::withMessages(['file' => 'A file can have at most '.number_format(self::MAX_ROWS).' redirects.']);
            }
            $rows[$line] = array_combine($header, array_pad(array_slice($cells, 0, count($header)), count($header), null));
        }
        fclose($stream);

        $created = 0;
        $updated = 0;
        $errors = [];
        foreach ($rows as $line => $row) {
            try {
                DB::transaction(function () use ($row, &$created, &$updated) {
                    $existing = UrlRedirect::where('from_path', UrlRedirect::normalize((string) ($row['from_path'] ?? '')))->first();
                    $data = $this->check([
                        'from_path' => $row['from_path'] ?? null,
                        'to_path' => $row['to_path'] ?? null,
                        'status_code' => filled($row['status_code'] ?? null) ? $row['status_code'] : 301,
                    ], $existing);
                    $existing ? $existing->fill($data)->save() : UrlRedirect::create($data);
                    $existing ? $updated++ : $created++;
                });
            } catch (ValidationException $e) {
                $errors[] = ['line' => $line, 'message' => collect($e->errors())->flatten()->first()];
            }
        }
        if ($created || $updated) {
            $this->audit->record('redirect.imported', "Redirects imported: {$created} added, {$updated} updated.", 'redirect', null,
                ['before' => [], 'after' => ['created' => $created, 'updated' => $updated, 'errors' => count($errors)]]);
            SeoController::forgetRedirects();
        }

        return response()->json(['data' => ['created' => $created, 'updated' => $updated, 'errors' => $errors]]);
    }

    public static function item(UrlRedirect $redirect): array
    {
        return [
            'id' => $redirect->id,
            'from_path' => $redirect->from_path,
            'to_path' => $redirect->to_path,
            'status_code' => $redirect->status_code,
            'hits' => $redirect->hits,
            'created_at' => $redirect->created_at?->toIso8601ZuluString(),
            'updated_at' => $redirect->updated_at?->toIso8601ZuluString(),
        ];
    }

    /** Validates and normalizes { from_path, to_path, status_code }; 422 with the field names. */
    private function check(array $input, ?UrlRedirect $current): array
    {
        $input['from_path'] = is_string($input['from_path'] ?? null) ? trim($input['from_path']) : ($input['from_path'] ?? null);
        $input['to_path'] = is_string($input['to_path'] ?? null) ? trim($input['to_path']) : ($input['to_path'] ?? null);
        $input['status_code'] ??= 301;

        $data = Validator::make($input, [
            'from_path' => ['required', 'string', 'max:255', 'regex:#^/[^?\#\s]*$#'],
            'to_path' => ['required', 'string', 'max:2048', 'regex:#^(/(?!/)\S*|https://\S+)$#i'],
            'status_code' => ['required', 'integer', Rule::in([301, 302])],
        ], [
            'from_path.required' => 'Enter the old path.',
            'from_path.regex' => 'The old path must start with "/" and can\'t have a query (?), # or spaces.',
            'to_path.required' => 'Enter where it should go.',
            'to_path.regex' => 'The new address must be a store path starting with "/" or an https:// address.',
            'status_code.in' => 'The type must be 301 (permanent) or 302 (temporary).',
        ])->validate();

        $from = UrlRedirect::normalize($data['from_path']);
        if ($from === '/') {
            throw ValidationException::withMessages(['from_path' => 'The home page can\'t be redirected.']);
        }
        if (UrlRedirect::where('from_path', $from)->when($current, fn ($q) => $q->whereKeyNot($current->id))->exists()) {
            throw ValidationException::withMessages(['from_path' => 'A redirect from this path already exists.']);
        }
        // A loop: following to_path through the other redirects comes back to from_path.
        $next = $data['to_path'];
        for ($steps = 0; $steps < 20 && str_starts_with($next, '/'); $steps++) {
            $target = UrlRedirect::normalize($next);
            if ($target === $from) {
                throw ValidationException::withMessages(['to_path' => "This would loop back to {$from}."]);
            }
            $hop = UrlRedirect::where('from_path', $target)->when($current, fn ($q) => $q->whereKeyNot($current->id))->value('to_path');
            if ($hop === null) {
                break;
            }
            $next = $hop;
        }

        return ['from_path' => $from, 'to_path' => $data['to_path'], 'status_code' => (int) $data['status_code']];
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Redirect not found.'], 404);
    }
}
