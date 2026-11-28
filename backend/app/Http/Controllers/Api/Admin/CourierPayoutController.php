<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\CourierPayout;
use App\Models\Shipment;
use App\Services\Audit;
use App\Services\Pricing;
use App\Services\Reports;
use App\Support\Currency;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Phase 21: courier payments received (/api/admin/v1/courier-payouts).
 * Couriers pay the cash they collected, minus their fees, every few days;
 * staff record each payment so the cash report knows what is still with
 * each courier. Listing needs reports.view; recording, changing and
 * deleting need cash.manage. Every change is in the audit log, and a
 * deleted payment is kept (soft delete) but no longer counts.
 *
 * The same courier, amount and date as a payment already recorded is
 * probably a double entry: 409 { message, duplicate_of } unless the request
 * says confirm_duplicate: true.
 */
class CourierPayoutController extends Controller
{
    private const AUDITED = ['carrier', 'amount', 'fees', 'currency', 'received_on', 'reference', 'note'];

    public function __construct(private Audit $audit, private Reports $reports) {}

    /** GET ?carrier&from&to&page&per_page → the payments, latest date first. from/to: received_on (inclusive). */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'carrier' => ['nullable', Rule::in(Shipment::COURIERS)],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ], [
            'carrier.in' => 'Choose a courier from the list.',
            'from.date_format' => 'Enter the start date as YYYY-MM-DD.',
            'to.date_format' => 'Enter the end date as YYYY-MM-DD.',
            'to.after_or_equal' => 'The end date must be on or after the start date.',
        ]);

        $page = CourierPayout::with('admin')
            ->when($data['carrier'] ?? null, fn ($query, $carrier) => $query->where('carrier', $carrier))
            ->when($data['from'] ?? null, fn ($query, $from) => $query->where('received_on', '>=', $from))
            ->when($data['to'] ?? null, fn ($query, $to) => $query->where('received_on', '<=', $to))
            ->orderByDesc('received_on')->orderByDesc('id')
            ->paginate($data['per_page'] ?? 20)->withQueryString()
            ->through(fn (CourierPayout $payout) => self::api($payout));

        return JsonResource::collection($page)->additional(['meta' => ['currency' => Currency::store(), 'timezone' => $this->reports->timezone()]])
            ->response();
    }

    /** POST { carrier, amount, fees?, received_on, reference?, note?, confirm_duplicate? } → 201 the payment; 409 a likely double entry. */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->rules(false), $this->messages());
        $amount = Pricing::format(Pricing::toCents((string) $data['amount']));

        if (! ($data['confirm_duplicate'] ?? false)) {
            $same = CourierPayout::with('admin')->where('carrier', $data['carrier'])->whereDate('received_on', $data['received_on'])
                ->where('amount', $amount)->orderBy('id')->first();
            if ($same) {
                return response()->json([
                    'message' => 'A payment of '.Currency::format($amount, $same->currency).' from '.$same->carrierLabel().' on '.$data['received_on']
                        .' is already recorded. Record this one too only if it is a second payment.',
                    'duplicate_of' => self::api($same),
                ], 409);
            }
        }

        $payout = DB::transaction(function () use ($data, $amount, $request) {
            $payout = CourierPayout::create([
                'carrier' => $data['carrier'],
                'amount' => $amount,
                'fees' => isset($data['fees']) ? Pricing::format(Pricing::toCents((string) $data['fees'])) : null,
                'currency' => Currency::store(),
                'received_on' => $data['received_on'],
                'reference' => self::text($data['reference'] ?? null),
                'note' => self::text($data['note'] ?? null),
                'admin_id' => $request->user()->id,
            ]);
            $this->audit->record('courier_payout.created', 'Payment of '.Currency::format($payout->amount, $payout->currency)." from {$payout->carrierLabel()} "
                ."received on {$payout->received_on->toDateString()} recorded.", 'courier_payout', $payout->id,
                Audit::created(Audit::fieldsOf($payout, self::AUDITED)));

            return $payout;
        });

        return response()->json(['data' => self::api($payout->load('admin'))], 201);
    }

    /** PATCH /{id} { any of the fields } → the payment. */
    public function update(Request $request, int $id): JsonResponse
    {
        $payout = CourierPayout::find($id);
        if (! $payout) {
            return $this->notFound();
        }
        $data = $request->validate($this->rules(true), $this->messages());
        unset($data['confirm_duplicate']);

        DB::transaction(function () use ($payout, $data) {
            $before = Audit::fieldsOf($payout, self::AUDITED);
            foreach ($data as $key => $value) {
                $payout->{$key} = match ($key) {
                    'amount' => Pricing::format(Pricing::toCents((string) $value)),
                    'fees' => $value === null ? null : Pricing::format(Pricing::toCents((string) $value)),
                    'reference', 'note' => self::text($value),
                    default => $value,
                };
            }
            $payout->save();
            if ($changes = Audit::diff($before, Audit::fieldsOf($payout, self::AUDITED))) {
                $this->audit->record('courier_payout.updated', "Payment from {$payout->carrierLabel()} received on {$payout->received_on->toDateString()} updated.",
                    'courier_payout', $payout->id, $changes);
            }
        });

        return response()->json(['data' => self::api($payout->fresh('admin'))]);
    }

    /** DELETE /{id} → 204. Kept (soft delete) for the audit trail; it no longer counts in the reports. */
    public function destroy(int $id): JsonResponse
    {
        $payout = CourierPayout::find($id);
        if (! $payout) {
            return $this->notFound();
        }
        DB::transaction(function () use ($payout) {
            $this->audit->record('courier_payout.deleted', 'Payment of '.Currency::format($payout->amount, $payout->currency)." from {$payout->carrierLabel()} "
                ."received on {$payout->received_on->toDateString()} deleted.", 'courier_payout', $payout->id,
                Audit::deleted(Audit::fieldsOf($payout, self::AUDITED)));
            $payout->delete();
        });

        return response()->json(null, 204);
    }

    /** { id, carrier, carrier_label, amount, fees, currency, received_on, reference, note, admin_name, created_at } */
    public static function api(CourierPayout $payout): array
    {
        return [
            'id' => $payout->id,
            'carrier' => $payout->carrier,
            'carrier_label' => $payout->carrierLabel(),
            'amount' => $payout->amount,
            'fees' => $payout->fees,
            'currency' => $payout->currency,
            'received_on' => $payout->received_on?->toDateString(),
            'reference' => $payout->reference,
            'note' => $payout->note,
            'admin_name' => $payout->admin?->name,
            'created_at' => $payout->created_at?->toIso8601ZuluString(),
        ];
    }

    private function rules(bool $patch): array
    {
        $required = $patch ? ['sometimes', 'required'] : ['required'];
        $today = $this->reports->today()->toDateString(); // the store's today: a payment can't arrive in the future

        return [
            'carrier' => [...$required, 'string', Rule::in(Shipment::COURIERS)],
            'amount' => [...$required, 'numeric', 'decimal:0,2', 'gt:0', 'max:9999999999.99'],
            'fees' => ['sometimes', 'nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:9999999999.99'],
            'received_on' => [...$required, 'date_format:Y-m-d', 'after_or_equal:2020-01-01', 'before_or_equal:'.$today],
            'reference' => ['sometimes', 'nullable', 'string', 'max:100'],
            'note' => ['sometimes', 'nullable', 'string', 'max:500'],
            'confirm_duplicate' => ['sometimes', 'boolean'],
        ];
    }

    private function messages(): array
    {
        return [
            'carrier.required' => 'Choose the courier that paid you.',
            'carrier.in' => 'Choose a courier from the list.',
            'amount.required' => 'Enter the amount you received.',
            'amount.numeric' => 'Enter the amount as a number, such as 9800 or 9800.50.',
            'amount.decimal' => 'Use at most 2 decimals.',
            'amount.gt' => 'The amount must be more than 0.',
            'amount.max' => 'That amount is too large.',
            'fees.numeric' => 'Enter the fees as a number, or leave them empty.',
            'fees.decimal' => 'Use at most 2 decimals.',
            'fees.min' => 'Fees can\'t be below 0.',
            'fees.max' => 'That amount is too large.',
            'received_on.required' => 'Enter the date the money arrived.',
            'received_on.date_format' => 'Enter the date as YYYY-MM-DD.',
            'received_on.after_or_equal' => 'The date can\'t be before 2020.',
            'received_on.before_or_equal' => 'The date can\'t be in the future.',
            'reference.max' => 'Keep the reference to 100 characters.',
            'note.max' => 'Keep the note to 500 characters.',
        ];
    }

    private static function text(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Courier payment not found.'], 404);
    }
}
