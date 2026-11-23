<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Mail\RenderedMail;
use App\Models\EmailTemplate;
use App\Services\Audit;
use App\Services\EmailTemplates;
use App\Services\HtmlSanitizer;
use App\Support\EmailTemplateCatalog;
use App\Support\Locale;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Traits\Localizable;
use Illuminate\Validation\ValidationException;

/**
 * Phase 7: Marketing → Email templates (email_templates.manage): list, edit
 * with the variable list, preview with sample data, send a test to yourself,
 * and reset to the default.
 *
 * Phase 13: every route takes `locale` (en|bn, default en; a query parameter,
 * or a body field on PUT/POST): which language version is listed, shown,
 * saved, reset, previewed, or sent as a test. Each language has its own
 * customization and its own default.
 */
class EmailTemplateController extends Controller
{
    use Localizable;

    private const LANGUAGE_NAMES = ['en' => 'English', 'bn' => 'Bangla'];

    public function __construct(private EmailTemplates $templates, private Audit $audit) {}

    /** GET /api/admin/v1/email-templates */
    public function index(Request $request): JsonResponse
    {
        $locale = $this->locale($request);
        $rows = EmailTemplate::with('updatedBy')->get();
        $saved = $rows->where('locale', $locale)->keyBy('key');

        return response()->json(['data' => array_map(fn ($key) => $this->listItem($key, $saved->get($key), $locale, $rows),
            EmailTemplateCatalog::keys())]);
    }

    /** GET /api/admin/v1/email-templates/{key} */
    public function show(Request $request, string $key): JsonResponse
    {
        return EmailTemplateCatalog::exists($key) ? $this->detail($key, $this->locale($request)) : $this->notFound();
    }

    /** PUT /api/admin/v1/email-templates/{key} { subject, body } */
    public function update(Request $request, string $key): JsonResponse
    {
        if (! EmailTemplateCatalog::exists($key)) {
            return $this->notFound();
        }
        $locale = $this->locale($request);
        [$subject, $body] = $this->draft($request, $key, required: true, locale: $locale);

        DB::transaction(function () use ($key, $subject, $body, $request, $locale) {
            $before = $this->templates->current($key, $locale);
            $this->templates->save($key, $subject, $body, $request->user(), $locale);
            $changes = Audit::diff(['subject' => $before['subject'], 'body' => md5($before['body'])], ['subject' => $subject, 'body' => md5($body)]);
            if ($changes && isset($changes['after']['body'])) {
                [$changes['before']['body'], $changes['after']['body']] = ['(changed)', '(changed)'];
            }
            $this->audit->record('email_template.updated', 'Email template "'.EmailTemplateCatalog::get($key)['name'].'"'.self::languageNote($locale).' updated.',
                'email_template', null, $changes);
        });

        return $this->detail($key, $locale);
    }

    /** POST /api/admin/v1/email-templates/{key}/preview { subject?, body? } → { subject, html, text } with sample data. */
    public function preview(Request $request, string $key): JsonResponse
    {
        if (! EmailTemplateCatalog::exists($key)) {
            return $this->notFound();
        }
        $locale = $this->locale($request);
        [$subject, $body] = $this->draft($request, $key, required: false, locale: $locale);

        return response()->json(['data' => $this->withLocale($locale,
            fn () => $this->templates->render($key, $this->templates->sampleValues($key), $subject, $body))]);
    }

    /** POST /api/admin/v1/email-templates/{key}/test { subject?, body? } - the sample email to the signed-in admin. */
    public function test(Request $request, string $key): JsonResponse
    {
        if (! EmailTemplateCatalog::exists($key)) {
            return $this->notFound();
        }
        $locale = $this->locale($request);
        [$subject, $body] = $this->draft($request, $key, required: false, locale: $locale);
        $rendered = $this->withLocale($locale, fn () => $this->templates->render($key, $this->templates->sampleValues($key), $subject, $body));
        $email = $request->user()->email;

        Mail::to($email)->send(new RenderedMail('[Test] '.$rendered['subject'], $rendered['html'], $rendered['text']));

        return response()->json(['message' => "Test email sent to {$email}.", 'data' => ['email' => $email]]);
    }

    /** POST /api/admin/v1/email-templates/{key}/reset - back to the default (deletes the customization). */
    public function reset(Request $request, string $key): JsonResponse
    {
        if (! EmailTemplateCatalog::exists($key)) {
            return $this->notFound();
        }
        $locale = $this->locale($request);
        DB::transaction(function () use ($key, $locale) {
            $this->templates->reset($key, $locale);
            $this->audit->record('email_template.reset', 'Email template "'.EmailTemplateCatalog::get($key)['name'].'"'.self::languageNote($locale).' reset to the default.', 'email_template');
        });

        return $this->detail($key, $locale);
    }

    /** Phase 13: the language version asked for (en by default); anything but en/bn is a 422. */
    private function locale(Request $request): string
    {
        $request->validate(['locale' => ['sometimes', 'nullable', 'string', 'in:'.implode(',', Locale::SUPPORTED)]],
            ['locale.in' => 'Choose English (en) or Bangla (bn).']);

        return Locale::normalize($request->input('locale')) ?? 'en';
    }

    /** "" for English (audit texts as before), " (Bangla)" otherwise. */
    private static function languageNote(string $locale): string
    {
        return $locale === 'en' ? '' : ' ('.self::LANGUAGE_NAMES[$locale].')';
    }

    /**
     * The subject and (sanitized) body sent, checked against the template's
     * variables; for preview/test a missing field uses the current template.
     *
     * @return array{0: ?string, 1: ?string}
     */
    private function draft(Request $request, string $key, bool $required, string $locale = 'en'): array
    {
        $rule = $required ? 'required' : 'sometimes';
        $data = $request->validate([
            'subject' => [$rule, 'string', 'min:1', 'max:200'],
            'body' => [$rule, 'string', 'min:1', 'max:'.HtmlSanitizer::MAX_LENGTH],
        ], ['subject.required' => 'Enter a subject.', 'body.required' => 'Write the email.']);

        $current = $this->templates->current($key, $locale);
        $subject = isset($data['subject']) ? trim(preg_replace('/\s+/u', ' ', $data['subject'])) : null;
        $body = isset($data['body']) ? $this->templates->sanitize($data['body']) : null;
        if ($body !== null && trim(strip_tags($body)) === '' && ! str_contains($body, '{{')) {
            throw ValidationException::withMessages(['body' => 'Write the email.']);
        }
        if ($errors = $this->templates->errors($key, $subject ?? $current['subject'], $body ?? $current['body'])) {
            throw ValidationException::withMessages($errors);
        }

        return [$subject, $body];
    }

    private function listItem(string $key, ?EmailTemplate $saved, string $locale, $rows): array
    {
        $definition = EmailTemplateCatalog::get($key, $locale);

        return [
            'locale' => $locale, // phase 13: the language version this entry describes
            'key' => $key,
            'name' => $definition['name'],
            'description' => $definition['description'],
            'subject' => $saved?->subject ?? $definition['subject'],
            'is_customized' => $saved !== null,
            'updated_at' => $saved?->updated_at?->toIso8601ZuluString(),
            'updated_by' => $saved?->updatedBy ? ['id' => $saved->updatedBy->id, 'name' => $saved->updatedBy->name] : null,
            // Phase 13: which language versions staff changed: { en: { is_customized, updated_at }, bn: { ... } }.
            'locales' => collect(Locale::SUPPORTED)->mapWithKeys(function (string $code) use ($rows, $key) {
                $row = $rows->first(fn (EmailTemplate $row) => $row->key === $key && ($row->locale ?: 'en') === $code);

                return [$code => ['is_customized' => $row !== null, 'updated_at' => $row?->updated_at?->toIso8601ZuluString()]];
            })->all(),
        ];
    }

    private function detail(string $key, string $locale = 'en'): JsonResponse
    {
        $rows = EmailTemplate::with('updatedBy')->where('key', $key)->get();
        $saved = $rows->firstWhere('locale', $locale);
        $definition = EmailTemplateCatalog::get($key, $locale);
        $alone = collect($definition['required'])->filter(fn (array $group) => count($group) === 1)->flatten()->all();

        return response()->json(['data' => [
            ...$this->listItem($key, $saved, $locale, $rows),
            'body' => $saved?->body ?? $definition['body'],
            'default_subject' => $definition['subject'],
            'default_body' => $definition['body'],
            'variables' => array_map(fn ($name, $info) => [
                'name' => $name, 'label' => $info[0], 'kind' => $info[1], 'required' => in_array($name, $alone, true),
            ], array_keys($definition['variables']), $definition['variables']),
            'required' => $definition['required'],
        ]]);
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Email template not found.'], 404);
    }
}
