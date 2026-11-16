<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Mail\NewsletterMail;
use App\Models\NewsletterCampaign;
use App\Services\Audit;
use App\Services\HtmlSanitizer;
use App\Services\Newsletter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Phase 7: Marketing → Newsletter campaigns. A campaign can be changed only
 * while it's a draft; sending queues batches of 100 (Newsletter::send()).
 */
class NewsletterCampaignController extends Controller
{
    private const AUDITED = ['subject', 'preheader', 'status'];

    public function __construct(private Audit $audit, private HtmlSanitizer $sanitizer, private Newsletter $newsletter) {}

    /** GET /api/admin/v1/newsletter/campaigns?status&search&page&per_page (newest first) */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'status' => ['nullable', Rule::in(NewsletterCampaign::STATUSES)],
            'search' => ['nullable', 'string', 'max:150'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $page = NewsletterCampaign::with('createdBy')
            ->when($data['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when($data['search'] ?? null, fn ($q, $search) => $q->where('subject', 'like', '%'.addcslashes($search, '%_\\').'%'))
            ->latest('id')->paginate($data['per_page'] ?? 20)->withQueryString()
            ->through(fn (NewsletterCampaign $campaign) => self::item($campaign));

        return JsonResource::collection($page);
    }

    /** GET /api/admin/v1/newsletter/campaigns/{id} */
    public function show(int $id): JsonResponse
    {
        $campaign = NewsletterCampaign::find($id);

        return $campaign ? $this->detail($campaign) : $this->notFound();
    }

    /** POST /api/admin/v1/newsletter/campaigns { subject, preheader?, body } → 201 */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request, true);
        $campaign = DB::transaction(function () use ($data, $request) {
            $campaign = NewsletterCampaign::create([...$data, 'status' => 'draft', 'created_by_admin_id' => $request->user()->id]);
            $this->audit->record('newsletter.campaign_created', "Newsletter \"{$campaign->subject}\" created.", 'newsletter_campaign', $campaign->id,
                Audit::created(Audit::fieldsOf($campaign, self::AUDITED)));

            return $campaign;
        });

        return $this->detail($campaign, 201);
    }

    /** PATCH /api/admin/v1/newsletter/campaigns/{id} - drafts only. */
    public function update(Request $request, int $id): JsonResponse
    {
        $campaign = NewsletterCampaign::find($id);
        if (! $campaign) {
            return $this->notFound();
        }
        $this->ensureDraft($campaign);
        $data = $this->validated($request, false);

        DB::transaction(function () use ($campaign, $data) {
            $before = Audit::fieldsOf($campaign, [...self::AUDITED, 'body']);
            $campaign->fill($data)->save();
            if ($changes = Audit::diff($before, Audit::fieldsOf($campaign, [...self::AUDITED, 'body']))) {
                // The body can be long: log only that it changed.
                if (isset($changes['after']['body'])) {
                    $changes['before']['body'] = '(changed)';
                    $changes['after']['body'] = '(changed)';
                }
                $this->audit->record('newsletter.campaign_updated', "Newsletter \"{$campaign->subject}\" updated.", 'newsletter_campaign', $campaign->id, $changes);
            }
        });

        return $this->detail($campaign->fresh());
    }

    /** DELETE /api/admin/v1/newsletter/campaigns/{id} - drafts only → 204 */
    public function destroy(int $id): JsonResponse
    {
        $campaign = NewsletterCampaign::find($id);
        if (! $campaign) {
            return $this->notFound();
        }
        $this->ensureDraft($campaign);
        DB::transaction(function () use ($campaign) {
            $campaign->delete();
            $this->audit->record('newsletter.campaign_deleted', "Newsletter \"{$campaign->subject}\" deleted.", 'newsletter_campaign', $campaign->id,
                Audit::deleted(Audit::fieldsOf($campaign, self::AUDITED)));
        });

        return response()->json(null, 204);
    }

    /** POST /api/admin/v1/newsletter/campaigns/{id}/test - to the signed-in admin only. */
    public function test(Request $request, int $id): JsonResponse
    {
        $campaign = NewsletterCampaign::find($id);
        if (! $campaign) {
            return $this->notFound();
        }
        $email = $request->user()->email;
        Mail::to($email)->send(new NewsletterMail($campaign, null, test: true));

        return response()->json(['message' => "Test email sent to {$email}.", 'data' => ['email' => $email]]);
    }

    /** POST /api/admin/v1/newsletter/campaigns/{id}/send → 202 (queued in batches of 100). */
    public function send(int $id): JsonResponse
    {
        $campaign = NewsletterCampaign::find($id);
        if (! $campaign) {
            return $this->notFound();
        }
        // Only one request can move a draft to "sending" (row lock), so it's never sent twice.
        $started = DB::transaction(function () use ($campaign) {
            $campaign = NewsletterCampaign::whereKey($campaign->id)->lockForUpdate()->first();
            $this->ensureDraft($campaign);
            if (! $this->newsletter->send($campaign)) {
                throw ValidationException::withMessages(['campaign' => 'Nobody is subscribed yet.']);
            }
            $this->audit->record('newsletter.campaign_sent', "Newsletter \"{$campaign->subject}\" sent to {$campaign->recipient_count} subscribers.",
                'newsletter_campaign', $campaign->id, ['before' => ['status' => 'draft'], 'after' => ['status' => 'sending', 'recipient_count' => $campaign->recipient_count]]);

            return $campaign;
        });

        return response()->json([
            'message' => "Sending to {$started->recipient_count} subscribers.",
            'data' => self::detailItem($started->fresh('createdBy')),
        ], 202);
    }

    public static function item(NewsletterCampaign $campaign): array
    {
        return [
            'id' => $campaign->id,
            'subject' => $campaign->subject,
            'preheader' => $campaign->preheader,
            'status' => $campaign->status,
            'recipient_count' => $campaign->recipient_count,
            'sent_count' => $campaign->sent_count,
            'failed_count' => $campaign->failed_count,
            'created_by' => $campaign->createdBy ? ['id' => $campaign->createdBy->id, 'name' => $campaign->createdBy->name] : null,
            'sent_at' => $campaign->sent_at?->toIso8601ZuluString(),
            'created_at' => $campaign->created_at?->toIso8601ZuluString(),
            'updated_at' => $campaign->updated_at?->toIso8601ZuluString(),
        ];
    }

    public static function detailItem(NewsletterCampaign $campaign): array
    {
        return [...self::item($campaign), 'body' => $campaign->body];
    }

    private function detail(NewsletterCampaign $campaign, int $status = 200): JsonResponse
    {
        return response()->json(['data' => self::detailItem($campaign->loadMissing('createdBy'))], $status);
    }

    private function ensureDraft(NewsletterCampaign $campaign): void
    {
        if ($campaign->status !== 'draft') {
            throw ValidationException::withMessages(['campaign' => 'This campaign has already been sent, so it can\'t be changed.']);
        }
    }

    private function validated(Request $request, bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';
        $data = $request->validate([
            'subject' => [$required, 'string', 'min:1', 'max:150'],
            'preheader' => ['sometimes', 'nullable', 'string', 'max:150'],
            'body' => [$required, 'string', 'max:'.HtmlSanitizer::MAX_LENGTH],
        ], ['subject.required' => 'Enter a subject.', 'body.required' => 'Write the newsletter.']);

        if (array_key_exists('body', $data)) {
            $data['body'] = $this->sanitizer->clean($data['body']);
            if (trim(strip_tags($data['body'])) === '') {
                throw ValidationException::withMessages(['body' => 'Write the newsletter.']);
            }
        }
        foreach (['subject', 'preheader'] as $field) {
            if (array_key_exists($field, $data) && is_string($data[$field])) {
                $data[$field] = trim($data[$field]) === '' ? null : trim($data[$field]);
            }
        }

        return $data;
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Campaign not found.'], 404);
    }
}
