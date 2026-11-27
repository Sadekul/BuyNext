<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\SmsMessageResource;
use App\Models\SmsMessage;
use App\Services\Sms\Sms;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/**
 * Phase 20: Settings → SMS (settings.view to see, settings.edit to change and
 * send a test) and the SMS log (orders.view; Retry needs orders.edit).
 * docs/backend/PHASE20_CONTRACT.md §1 → Admin API.
 */
class SmsController extends Controller
{
    public function __construct(private Sms $sms) {}

    /** GET /api/admin/v1/sms → { data: { settings, providers: [{ key, label, configured }], stats, defaults: { templates, variables } } } */
    public function show(): JsonResponse
    {
        return response()->json(['data' => $this->sms->adminPayload()]);
    }

    /** PUT /api/admin/v1/sms/settings { sms_enabled?, sms_provider?, sms_events?, sms_templates?, sms_confirm_link? } (partial) → same as GET */
    public function update(Request $request): JsonResponse
    {
        $this->sms->update($this->sms->validated($request->all()));

        return response()->json(['data' => $this->sms->adminPayload()]);
    }

    /** POST /api/admin/v1/sms/test { to, body? } → { data: SmsMessage } (sent through the chosen provider; 422 for a bad number). */
    public function test(Request $request): SmsMessageResource
    {
        $data = $request->validate([
            'to' => ['required', 'string', 'max:30'],
            'body' => ['nullable', 'string', 'max:'.Sms::TEMPLATE_MAX],
        ], ['to.required' => 'Enter the mobile number to send the test to.']);

        return new SmsMessageResource($this->sms->sendTest($request->user(), $data['to'], $data['body'] ?? null));
    }

    /**
     * GET /api/admin/v1/sms/messages?status&event&search&page&per_page → { data: [SmsMessage], links, meta }, newest first.
     * search: an order number or (part of) the phone number; event "test" = test sends.
     */
    public function messages(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'status' => ['nullable', Rule::in(SmsMessage::STATUSES)],
            'event' => ['nullable', Rule::in([...Sms::EVENTS, 'test'])],
            'search' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $query = SmsMessage::with('order:id,number')->latest('id');
        if (isset($data['status'])) {
            $query->where('status', $data['status']);
        }
        if (isset($data['event'])) {
            $data['event'] === 'test' ? $query->whereNull('event') : $query->where('event', $data['event']);
        }
        if (filled($data['search'] ?? null)) {
            $search = trim($data['search']);
            $digits = preg_replace('/\D/', '', $search);
            $query->where(function ($q) use ($search, $digits) {
                $q->whereHas('order', fn ($o) => $o->where('number', strtoupper($search)));
                if (strlen($digits) >= 3) {
                    // "01712…" and "+8801712…" find the same number.
                    $q->orWhere('to', 'like', '%'.ltrim($digits, '0').'%');
                }
            });
        }

        return SmsMessageResource::collection($query->paginate($data['per_page'] ?? 20)->withQueryString());
    }

    /** POST /api/admin/v1/sms/messages/{id}/retry → { data: SmsMessage }; 422 when it isn't failed or was tried 5 times. */
    public function retry(int $id): SmsMessageResource|JsonResponse
    {
        $message = SmsMessage::find($id);
        if (! $message) {
            return response()->json(['message' => 'Text not found.'], 404);
        }

        return new SmsMessageResource($this->sms->retry($message)->load('order:id,number'));
    }
}
