<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Mail\GiftCardReceivedMail;
use App\Models\CreditMemo;
use App\Models\GiftCard;
use App\Models\GiftCardTransaction;
use App\Models\Invoice;
use App\Models\OrderItem;
use App\Services\Audit;
use App\Services\GiftCards;
use App\Services\Pricing;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Phase 10 (part B): Marketing → Gift cards. List, read (with history),
 * create (e.g. compensation; emailed), adjust the balance with a note,
 * disable/enable, and the gift card report. The code is shown only once,
 * in the answer of create.
 */
class GiftCardController extends Controller
{
    private const WITH = ['purchaserOrderItem.order', 'createdBy'];

    public function __construct(private GiftCards $giftCards, private Audit $audit) {}

    /** GET /api/admin/v1/gift-cards?search&status&page&per_page - newest first. */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(GiftCard::STATUSES)],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $cards = GiftCard::with(self::WITH)
            ->when($data['search'] ?? null, function ($query, $search) {
                $code = GiftCards::normalize($search);
                $like = '%'.addcslashes($search, '%_\\').'%';
                $query->where(fn ($q) => $q->where('recipient_email', 'like', $like)->orWhere('recipient_name', 'like', $like)
                    ->when(strlen($code) >= 4, fn ($q) => $q->orWhere('last4', substr($code, -4)))
                    ->orWhereHas('purchaserOrderItem.order', fn ($o) => $o->where('number', strtoupper(trim($search)))));
            })
            ->when($data['status'] ?? null, function ($query, $status) {
                match ($status) {
                    'expired' => $query->where(fn ($q) => $q->where('status', 'expired')
                        ->orWhere(fn ($q) => $q->where('status', 'active')->whereNotNull('expires_at')->where('expires_at', '<=', now()))),
                    'active' => $query->where('status', 'active')->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now())),
                    default => $query->where('status', $status),
                };
            })
            ->latest('id')
            ->paginate($data['per_page'] ?? 20)
            ->withQueryString();

        return response()->json([
            'data' => collect($cards->items())->map(fn (GiftCard $card) => GiftCards::api($card))->values(),
            'links' => ['first' => $cards->url(1), 'last' => $cards->url($cards->lastPage()), 'prev' => $cards->previousPageUrl(), 'next' => $cards->nextPageUrl()],
            'meta' => ['current_page' => $cards->currentPage(), 'last_page' => $cards->lastPage(), 'per_page' => $cards->perPage(), 'total' => $cards->total()],
        ]);
    }

    /** GET /api/admin/v1/gift-cards/{id} → { data: card + transactions } */
    public function show(int $id): JsonResponse
    {
        $card = GiftCard::with(self::WITH)->find($id);

        return $card ? response()->json(['data' => $this->detail($card)]) : $this->notFound();
    }

    /**
     * POST /api/admin/v1/gift-cards { amount, recipient_email?, recipient_name?, message?, expires_at?, notify_recipient? }
     * → 201 { data: card + code }. The code is only in this answer (and the recipient's email).
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'decimal:0,2', 'min:0.01', 'max:100000'],
            'recipient_email' => ['nullable', 'string', 'email', 'max:190'],
            'recipient_name' => ['nullable', 'string', 'max:120'],
            'message' => ['nullable', 'string', 'max:500'],
            'expires_at' => ['nullable', 'date', 'after:now'],
            'notify_recipient' => ['nullable', 'boolean'],
        ], ['expires_at.after' => 'The expiry date must be in the future.']);
        $notify = (bool) ($data['notify_recipient'] ?? true) && filled($data['recipient_email'] ?? null);
        $admin = $request->user();

        [$card, $code] = DB::transaction(function () use ($data, $admin, $notify) {
            [$card, $code] = $this->giftCards->create(Pricing::toCents((string) $data['amount']), [
                'recipient_email' => filled($data['recipient_email'] ?? null) ? mb_strtolower(trim($data['recipient_email'])) : null,
                'recipient_name' => filled($data['recipient_name'] ?? null) ? trim($data['recipient_name']) : null,
                'message' => filled($data['message'] ?? null) ? trim($data['message']) : null,
                'expires_at' => GiftCards::parseDate($data['expires_at'] ?? null),
            ], $admin, 'Created by staff.');
            $this->audit->record('gift_card.created', "Gift card ••••{$card->last4} created (\${$card->initial_balance})"
                .($card->recipient_email ? " for {$card->recipient_email}" : '').'.', 'gift_card', $card->id,
                Audit::created(['last4' => $card->last4, 'amount' => $card->initial_balance, 'recipient_email' => $card->recipient_email,
                    'expires_at' => $card->expires_at?->toIso8601ZuluString(), 'emailed' => $notify]), $admin);
            if ($notify) {
                $this->giftCards->sendAfterCommit([[$card->recipient_email, new GiftCardReceivedMail($card, $code)]]);
            }

            return [$card, $code];
        });

        return response()->json(['data' => [...$this->detail($card->fresh(self::WITH)), 'code' => GiftCards::format($code)]], 201);
    }

    /** POST /api/admin/v1/gift-cards/{id}/adjust { amount (signed), note } → { data } */
    public function adjust(Request $request, int $id): JsonResponse
    {
        $card = GiftCard::find($id);
        if (! $card) {
            return $this->notFound();
        }
        $data = $request->validate([
            'amount' => ['required', 'regex:/^-?\d{1,6}(\.\d{1,2})?$/'],
            'note' => ['required', 'string', 'min:3', 'max:500'],
        ], [
            'amount.regex' => 'Enter the change as an amount, for example 10.00 or -10.00.',
            'note.required' => 'Say why the balance changes.',
        ]);
        $cents = Pricing::toCents((string) $data['amount']);
        if ($cents === 0) {
            throw ValidationException::withMessages(['amount' => 'Enter an amount other than 0.00.']);
        }
        $this->giftCards->adjust($card, $cents, trim($data['note']), $request->user());

        return response()->json(['data' => $this->detail($card->fresh(self::WITH))]);
    }

    /** PATCH /api/admin/v1/gift-cards/{id} { status?: active|disabled, expires_at?: ISO|null } → { data } */
    public function update(Request $request, int $id): JsonResponse
    {
        $card = GiftCard::find($id);
        if (! $card) {
            return $this->notFound();
        }
        $data = $request->validate([
            'status' => ['sometimes', Rule::in(['active', 'disabled'])],
            'expires_at' => ['sometimes', 'nullable', 'date'],
        ], ['status.in' => 'The status must be active or disabled.']);

        DB::transaction(function () use ($card, $data) {
            $card = GiftCard::whereKey($card->id)->lockForUpdate()->first();
            $before = ['status' => $card->status, 'expires_at' => $card->expires_at?->toIso8601ZuluString()];
            if (array_key_exists('status', $data)) {
                $card->status = $data['status'];
            }
            if (array_key_exists('expires_at', $data)) {
                $card->expires_at = GiftCards::parseDate($data['expires_at']);
            }
            $card->save();
            $after = ['status' => $card->status, 'expires_at' => $card->expires_at?->toIso8601ZuluString()];
            if ($changes = Audit::diff($before, $after)) {
                $this->audit->record('gift_card.updated', "Gift card ••••{$card->last4} updated.", 'gift_card', $card->id, $changes);
            }
        });

        return response()->json(['data' => $this->detail($card->fresh(self::WITH))]);
    }

    /**
     * GET /api/admin/v1/reports/gift-cards?from&to (dates, inclusive; default the last 30 days)
     * → { data: { from, to, sold, issued_by_staff, redeemed, returned, outstanding_balance, active_cards } }
     */
    public function report(Request $request): JsonResponse
    {
        $data = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
        ]);
        $to = isset($data['to']) ? Carbon::parse($data['to'])->endOfDay() : now()->endOfDay();
        $from = isset($data['from']) ? Carbon::parse($data['from'])->startOfDay() : $to->copy()->subDays(29)->startOfDay();

        // Sold: gift card lines of orders invoiced (paid) in the period.
        $sold = OrderItem::whereNotNull('gift_card')
            ->whereIn('order_id', Invoice::whereBetween('created_at', [$from, $to])->select('order_id'))
            ->get();
        $issued = GiftCard::whereNotNull('created_by_admin_id')->whereBetween('created_at', [$from, $to]);
        $movements = GiftCardTransaction::whereBetween('created_at', [$from, $to]);
        // Rows with an order are spending (negative) and money given back by a cancel or a refund (positive).
        $redeemed = -1 * Pricing::toCents((string) (clone $movements)->whereNotNull('order_id')->where('amount', '<', 0)->sum('amount'));
        $returned = Pricing::toCents((string) (clone $movements)->whereNotNull('order_id')->where('amount', '>', 0)->sum('amount'));
        $active = GiftCard::where('status', 'active')->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()));

        return response()->json(['data' => [
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'sold' => ['count' => (int) $sold->sum('quantity'), 'amount' => Pricing::format((int) $sold->sum(fn ($item) => Pricing::toCents($item->line_total)))],
            'issued_by_staff' => ['count' => (clone $issued)->count(), 'amount' => Pricing::format(Pricing::toCents((string) (clone $issued)->sum('initial_balance')))],
            'redeemed' => Pricing::format($redeemed),
            'returned' => Pricing::format($returned),
            'outstanding_balance' => Pricing::format(Pricing::toCents((string) (clone $active)->sum('balance'))),
            'active_cards' => (clone $active)->count(),
        ]]);
    }

    private function detail(GiftCard $card): array
    {
        $memoNumbers = CreditMemo::whereIn('id', $card->transactions()->whereNotNull('credit_memo_id')->pluck('credit_memo_id'))->pluck('number', 'id');

        return [
            ...GiftCards::api($card),
            'transactions' => $card->transactions()->with(['order:id,number', 'admin:id,name'])->get()->map(fn (GiftCardTransaction $t) => [
                'id' => $t->id,
                'amount' => $t->amount,
                'balance_after' => $t->balance_after,
                'note' => $t->note,
                'order_number' => $t->order?->number,
                'credit_memo_number' => $t->credit_memo_id ? ($memoNumbers[$t->credit_memo_id] ?? null) : null,
                'admin_name' => $t->admin?->name,
                'created_at' => $t->created_at?->toIso8601ZuluString(),
            ])->values(),
        ];
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Gift card not found.'], 404);
    }
}
