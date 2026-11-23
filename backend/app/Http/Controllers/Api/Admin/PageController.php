<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\PageResource;
use App\Models\Page;
use App\Services\Audit;
use App\Services\HtmlSanitizer;
use App\Support\TranslationInput;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** Content pages (Magento's Content → Pages). The body is sanitized on every save. */
class PageController extends Controller
{
    private const FIELDS = ['slug', 'title', 'body', 'meta_title', 'meta_description', 'is_published'];

    public function __construct(private Audit $audit, private HtmlSanitizer $sanitizer) {}

    /** GET /api/admin/v1/pages?search&status=published|draft&page&per_page - by title. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', 'in:published,draft'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $pages = Page::query()->with('translations')
            ->when($data['search'] ?? null, function ($query, $search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $query->where(fn ($q) => $q->where('title', 'like', $like)->orWhere('slug', 'like', $like));
            })
            ->when($data['status'] ?? null, fn ($query, $status) => $query->where('is_published', $status === 'published'))
            ->orderBy('title')->orderBy('id')
            ->paginate($data['per_page'] ?? 50)
            ->withQueryString();

        return PageResource::collection($pages);
    }

    /** GET /api/admin/v1/pages/{id} */
    public function show(int $id): PageResource|JsonResponse
    {
        $page = Page::find($id);

        return $page ? new PageResource($page) : $this->notFound();
    }

    /** POST /api/admin/v1/pages { slug, title, body, meta_title?, meta_description?, is_published? } → 201 */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request, null);

        $page = DB::transaction(function () use ($data) {
            $page = Page::create([...TranslationInput::strip($data), 'is_published' => $data['is_published'] ?? true]);
            $this->audit->record('page.created', "Page \"{$page->title}\" (/pages/{$page->slug}) created.", 'page', $page->id,
                Audit::created(Audit::fieldsOf($page, array_diff(self::FIELDS, ['body']))));
            $this->saveBangla($page, $data);

            return $page;
        });

        return (new PageResource($page->fresh()))->response()->setStatusCode(201);
    }

    /** PATCH /api/admin/v1/pages/{id} - any of the create fields. */
    public function update(Request $request, int $id): PageResource|JsonResponse
    {
        $page = Page::find($id);
        if (! $page) {
            return $this->notFound();
        }
        $data = $this->validated($request, $page);

        DB::transaction(function () use ($page, $data) {
            $before = Audit::fieldsOf($page, self::FIELDS);
            $page->fill(TranslationInput::strip($data))->save();
            $changes = Audit::diff($before, Audit::fieldsOf($page, self::FIELDS));
            if ($changes) {
                $this->audit->record('page.updated', "Page \"{$page->title}\" (/pages/{$page->slug}) updated.", 'page', $page->id,
                    $this->withoutBodies($changes));
            }
            $this->saveBangla($page, $data);
        });

        return new PageResource($page->fresh());
    }

    /** DELETE /api/admin/v1/pages/{id} → 204 */
    public function destroy(int $id): JsonResponse
    {
        $page = Page::find($id);
        if (! $page) {
            return $this->notFound();
        }
        DB::transaction(function () use ($page) {
            $this->audit->record('page.deleted', "Page \"{$page->title}\" (/pages/{$page->slug}) deleted.", 'page', $page->id,
                Audit::deleted(Audit::fieldsOf($page, array_diff(self::FIELDS, ['body']))));
            $page->delete();
        });

        return response()->json(null, 204);
    }

    private function validated(Request $request, ?Page $page): array
    {
        $required = $page ? 'sometimes' : 'required';
        if ($request->has('slug')) {
            $request->merge(['slug' => mb_strtolower(trim((string) $request->input('slug')))]);
        }

        $data = $request->validate([
            'slug' => [$required, 'string', 'max:80', 'regex:'.Page::SLUG_PATTERN, Rule::unique('pages', 'slug')->ignore($page?->id)],
            'title' => [$required, 'string', 'max:160'],
            'body' => [$required, 'string', 'max:'.HtmlSanitizer::MAX_LENGTH],
            'meta_title' => ['nullable', 'string', 'max:160'],
            'meta_description' => ['nullable', 'string', 'max:300'],
            'is_published' => ['sometimes', 'boolean'],
            // Phase 13: translations.bn.{title, body, meta_title, meta_description}.
            ...TranslationInput::rules(['title' => 160, 'body' => null, 'meta_title' => 160, 'meta_description' => 300]),
        ], [
            'slug.regex' => 'The address can only have lower-case letters, digits, and single dashes (for example "shipping-and-returns").',
            'slug.unique' => 'Another page already uses this address.',
        ]);

        if (array_key_exists('body', $data)) {
            $data['body'] = $this->sanitizer->clean($data['body']);
        }

        return $data;
    }

    /** Phase 13: saves translations.bn and logs which Bangla fields changed. */
    private function saveBangla(Page $page, array $data): void
    {
        $fields = TranslationInput::save($page, $data, html: ['body']);
        if ($fields) {
            $this->audit->record('page.translated', "Page \"{$page->title}\" Bangla text updated (".implode(', ', $fields).').', 'page', $page->id);
        }
    }

    /** A body can be long: the log says it changed and how long it is, not the whole text twice. */
    private function withoutBodies(array $changes): array
    {
        foreach (['before', 'after'] as $side) {
            if (isset($changes[$side]['body'])) {
                $changes[$side]['body'] = '('.mb_strlen($changes[$side]['body']).' characters)';
            }
        }

        return $changes;
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Page not found.'], 404);
    }
}
