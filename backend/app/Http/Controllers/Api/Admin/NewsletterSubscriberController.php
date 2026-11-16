<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\NewsletterSubscriber;
use App\Services\Audit;
use App\Services\Newsletter;
use App\Support\Csv;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** Phase 7: Marketing → Newsletter subscribers (list, CSV export, unsubscribe). */
class NewsletterSubscriberController extends Controller
{
    public function __construct(private Audit $audit, private Newsletter $newsletter) {}

    /** GET /api/admin/v1/newsletter/subscribers?status&source&search&page&per_page (newest first) + meta.counts */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $this->filters($request);
        $page = $this->query($data)->with('customer')->latest('id')
            ->paginate($data['per_page'] ?? 50)->withQueryString()
            ->through(fn (NewsletterSubscriber $subscriber) => self::item($subscriber));
        $counts = NewsletterSubscriber::selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');

        return JsonResource::collection($page)->additional(['meta' => ['counts' => collect(NewsletterSubscriber::STATUSES)
            ->mapWithKeys(fn ($status) => [$status => (int) ($counts[$status] ?? 0)])]]);
    }

    /** GET /api/admin/v1/newsletter/subscribers/export.csv (same filters) */
    public function export(Request $request): Response
    {
        $rows = $this->query($this->filters($request))->with('customer')->latest('id')->get()
            ->map(fn (NewsletterSubscriber $s) => [
                $s->email, $s->status, $s->source, $s->customer_id,
                $s->customer ? trim("{$s->customer->first_name} {$s->customer->last_name}") : '',
                $s->confirmed_at?->toIso8601ZuluString(), $s->unsubscribed_at?->toIso8601ZuluString(), $s->created_at?->toIso8601ZuluString(),
            ]);

        return Csv::download('newsletter-subscribers-'.now()->toDateString().'.csv',
            ['email', 'status', 'source', 'customer_id', 'customer_name', 'confirmed_at', 'unsubscribed_at', 'created_at'], $rows);
    }

    /** POST /api/admin/v1/newsletter/subscribers/{id}/unsubscribe */
    public function unsubscribe(int $id): JsonResponse
    {
        $subscriber = NewsletterSubscriber::find($id);
        if (! $subscriber) {
            return response()->json(['message' => 'Subscriber not found.'], 404);
        }
        DB::transaction(function () use ($subscriber) {
            $before = $subscriber->status;
            $this->newsletter->unsubscribe($subscriber);
            if ($before !== 'unsubscribed') {
                $this->audit->record('newsletter.subscriber_unsubscribed', "Newsletter subscriber {$subscriber->email} unsubscribed.",
                    'newsletter_subscriber', $subscriber->id, ['before' => ['status' => $before], 'after' => ['status' => 'unsubscribed']]);
            }
        });

        return response()->json(['data' => self::item($subscriber->fresh('customer'))]);
    }

    public static function item(NewsletterSubscriber $subscriber): array
    {
        return [
            'id' => $subscriber->id,
            'email' => $subscriber->email,
            'status' => $subscriber->status,
            'source' => $subscriber->source,
            'customer' => $subscriber->customer
                ? ['id' => $subscriber->customer->id, 'name' => trim("{$subscriber->customer->first_name} {$subscriber->customer->last_name}")]
                : null,
            'confirmed_at' => $subscriber->confirmed_at?->toIso8601ZuluString(),
            'unsubscribed_at' => $subscriber->unsubscribed_at?->toIso8601ZuluString(),
            'created_at' => $subscriber->created_at?->toIso8601ZuluString(),
            'updated_at' => $subscriber->updated_at?->toIso8601ZuluString(),
        ];
    }

    private function filters(Request $request): array
    {
        return $request->validate([
            'status' => ['nullable', Rule::in(NewsletterSubscriber::STATUSES)],
            'source' => ['nullable', Rule::in(NewsletterSubscriber::SOURCES)],
            'search' => ['nullable', 'string', 'max:190'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
    }

    private function query(array $data): Builder
    {
        return NewsletterSubscriber::query()
            ->when($data['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when($data['source'] ?? null, fn ($q, $source) => $q->where('source', $source))
            ->when($data['search'] ?? null, fn ($q, $search) => $q->where('email', 'like', '%'.addcslashes(mb_strtolower($search), '%_\\').'%'));
    }
}
