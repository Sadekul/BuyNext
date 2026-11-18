<?php

namespace App\Services;

use App\Mail\GiftCardPurchasedMail;
use App\Mail\GiftCardReceivedMail;
use App\Models\Admin;
use App\Models\CreditMemo;
use App\Models\GiftCard;
use App\Models\GiftCardTransaction;
use App\Models\Order;
use App\Models\OrderItem;
use Illuminate\Mail\Mailable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Phase 10 (part B): gift cards.
 *
 * - Codes: 16 characters from an alphabet without look-alikes (no 0/O, 1/I/L),
 *   made with random_int (a CSPRNG): 31^16 ≈ 7.7 × 10^23 codes. Only the
 *   SHA-256 of the code and its last 4 characters are stored, so a database
 *   copy can't be used to spend cards. Shown as XXXX-XXXX-XXXX-XXXX; typed
 *   codes ignore case, spaces, and dashes.
 * - The balance changes only here, with the card row locked (lockForUpdate),
 *   and every change is a gift_card_transactions row (negative = spent).
 * - Unknown, disabled, and expired codes all get the same answer, so codes
 *   can't be probed.
 */
class GiftCards
{
    public const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    public const LENGTH = 16;

    public const INVALID = 'This gift card code isn\'t valid.';

    public function __construct(private Audit $audit) {}

    /** "abcd-efgh jkmn" → "ABCDEFGHJKMN". */
    public static function normalize(?string $code): string
    {
        return strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', (string) $code));
    }

    public static function hash(string $normalized): string
    {
        return hash('sha256', $normalized);
    }

    /** "ABCDEFGHJKMNPQRS" → "ABCD-EFGH-JKMN-PQRS". */
    public static function format(string $code): string
    {
        return implode('-', str_split($code, 4));
    }

    /** A new random code no card uses yet (normalized). */
    public function generateCode(): string
    {
        do {
            $code = '';
            for ($i = 0; $i < self::LENGTH; $i++) {
                $code .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
            }
        } while (GiftCard::where('code_hash', self::hash($code))->exists());

        return $code;
    }

    /** The card with this code (any status), or null. With $lock the row stays locked until the transaction ends. */
    public function find(?string $code, bool $lock = false): ?GiftCard
    {
        $code = self::normalize($code);
        if (strlen($code) !== self::LENGTH) {
            return null;
        }
        $query = GiftCard::where('code_hash', self::hash($code));

        return ($lock ? $query->lockForUpdate() : $query)->first();
    }

    /** A card that may be spent: active and not expired; null otherwise (the same answer for every reason). */
    public function usable(?string $code, bool $lock = false): ?GiftCard
    {
        $card = $this->find($code, $lock);

        return $card && $card->isUsable() ? $card : null;
    }

    /**
     * Creates a card for $cents with a new code. Returns [card, code]: the
     * code exists only in this answer (and the recipient's email).
     */
    public function create(int $cents, array $attributes, ?Admin $admin = null, ?string $note = null): array
    {
        $code = $this->generateCode();
        $card = GiftCard::create([
            'code_hash' => self::hash($code),
            'last4' => substr($code, -4),
            'initial_balance' => Pricing::format($cents),
            'balance' => Pricing::format($cents),
            'currency' => strtoupper((string) config('buynest.store.currency', 'USD')),
            'status' => 'active',
            'expires_at' => $attributes['expires_at'] ?? null,
            'purchaser_order_item_id' => $attributes['purchaser_order_item_id'] ?? null,
            'recipient_email' => $attributes['recipient_email'] ?? null,
            'recipient_name' => $attributes['recipient_name'] ?? null,
            'message' => $attributes['message'] ?? null,
            'created_by_admin_id' => $admin?->id,
        ]);
        $this->record($card, $cents, $note ?? 'Card created.', admin: $admin);

        return [$card, $code];
    }

    /** Spends $cents of $card (locked, usable) for $order, at checkout. */
    public function redeem(GiftCard $card, int $cents, Order $order): void
    {
        if ($cents <= 0) {
            return;
        }
        if (! $card->isUsable() || Pricing::toCents($card->balance) < $cents) {
            throw ValidationException::withMessages(['gift_card_code' => self::INVALID]);
        }
        $this->change($card, -$cents, "Spent on order {$order->number}.", orderId: $order->id);
    }

    /** The order was cancelled: what the card paid (less what refunds already returned) goes back to it. */
    public function release(Order $order): void
    {
        $cents = Pricing::toCents($order->gift_card_amount ?? 0) - $this->returnedCents($order);
        if (! $order->gift_card_id || $cents <= 0) {
            return;
        }
        $card = GiftCard::whereKey($order->gift_card_id)->lockForUpdate()->first();
        if ($card) {
            $this->change($card, $cents, "Order {$order->number} cancelled: amount returned.", orderId: $order->id);
        }
    }

    /** What credit memos already gave back to the order's gift card, in cents. */
    public function returnedCents(Order $order): int
    {
        return (int) CreditMemo::where('order_id', $order->id)->get()->sum(fn ($memo) => Pricing::toCents($memo->gift_card_refund));
    }

    /** What a new refund can still return to the order's gift card, in cents. */
    public function refundableCents(Order $order): int
    {
        return $order->gift_card_id ? max(0, Pricing::toCents($order->gift_card_amount ?? 0) - $this->returnedCents($order)) : 0;
    }

    /** A credit memo returns $cents to the order's gift card. */
    public function refundTo(Order $order, int $cents, CreditMemo $memo): void
    {
        if ($cents <= 0 || ! $order->gift_card_id) {
            return;
        }
        $card = GiftCard::whereKey($order->gift_card_id)->lockForUpdate()->firstOrFail();
        $this->change($card, $cents, "Refund {$memo->number} on order {$order->number}.", orderId: $order->id, creditMemoId: $memo->id);
    }

    /** Staff change the balance by $cents (signed) with a note; it can't go below 0. */
    public function adjust(GiftCard $card, int $cents, string $note, Admin $admin): GiftCard
    {
        return DB::transaction(function () use ($card, $cents, $note, $admin) {
            $card = GiftCard::whereKey($card->id)->lockForUpdate()->firstOrFail();
            $before = $card->balance;
            if (Pricing::toCents($card->balance) + $cents < 0) {
                throw ValidationException::withMessages(['amount' => 'The balance can\'t go below $0.00 (it is $'.$card->balance.').']);
            }
            $this->change($card, $cents, $note, admin: $admin);
            $this->audit->record('gift_card.adjusted', "Gift card ••••{$card->last4}: balance \${$before} → \${$card->balance}.", 'gift_card', $card->id,
                ['before' => ['balance' => $before], 'after' => ['balance' => $card->balance, 'note' => $note]], $admin);

            return $card;
        });
    }

    /**
     * The order was invoiced (paid): creates the cards it bought (one per
     * unit, once per line) and emails them after the commit: the code to each
     * recipient, a copy without the code to the buyer.
     */
    public function issueFor(Order $order): void
    {
        $order->loadMissing('items');
        $mails = [];
        foreach ($order->items->filter(fn (OrderItem $item) => $item->isGiftCard()) as $item) {
            $existing = GiftCard::where('purchaser_order_item_id', $item->id)->count();
            $details = $item->gift_card;
            for ($n = $existing; $n < $item->quantity; $n++) {
                [$card, $code] = $this->create(Pricing::toCents((string) $details['amount']), [
                    'purchaser_order_item_id' => $item->id,
                    'recipient_email' => $details['recipient_email'] ?? null,
                    'recipient_name' => $details['recipient_name'] ?? null,
                    'message' => $details['message'] ?? null,
                ], note: "Bought with order {$order->number}."); // no order_id: order rows are spending and returns only
                if ($card->recipient_email) {
                    $mails[] = [$card->recipient_email, new GiftCardReceivedMail($card, $code, self::senderName($order))];
                }
                $mails[] = [$order->email, new GiftCardPurchasedMail($order, $card)];
            }
        }
        $this->sendAfterCommit($mails);
    }

    /**
     * A credit memo refunds $quantity units of a gift card purchase line: that
     * many unused cards from it are disabled. A card with spending can't be
     * taken back (422 on $errorKey).
     */
    public function disableForRefund(OrderItem $item, int $quantity, string $errorKey): void
    {
        if ($quantity <= 0) {
            return;
        }
        $cards = GiftCard::where('purchaser_order_item_id', $item->id)->where('status', '!=', 'disabled')->orderBy('id')->lockForUpdate()->get();
        $unused = $cards->filter(fn (GiftCard $card) => $card->balance === $card->initial_balance)->values();
        $notIssued = max(0, $item->quantity - GiftCard::where('purchaser_order_item_id', $item->id)->count());
        if ($unused->count() + $notIssued < $quantity) {
            $used = $quantity - $unused->count() - $notIssued;
            throw ValidationException::withMessages([$errorKey => $used === 1
                ? '1 gift card from this line was already used, so it can\'t be refunded.'
                : "{$used} gift cards from this line were already used, so they can't be refunded."]);
        }
        foreach ($unused->take(max(0, $quantity - $notIssued)) as $card) {
            $card->forceFill(['status' => 'disabled'])->save();
            $this->record($card, 0, "Disabled: the purchase on order {$item->order?->number} was refunded.");
        }
    }

    /** Admin answer of a card (see the contract's part B notes). */
    public static function api(GiftCard $card): array
    {
        $order = $card->purchaserOrderItem?->order;

        return [
            'id' => $card->id,
            'last4' => $card->last4,
            'initial_balance' => $card->initial_balance,
            'balance' => $card->balance,
            'currency' => $card->currency,
            'status' => $card->effectiveStatus(),
            'expires_at' => $card->expires_at?->toIso8601ZuluString(),
            'recipient_name' => $card->recipient_name,
            'recipient_email' => $card->recipient_email,
            'message' => $card->message,
            'purchase_order_number' => $order?->number,
            'created_by_admin' => $card->createdBy ? ['id' => $card->createdBy->id, 'name' => $card->createdBy->name] : null,
            'created_at' => $card->created_at?->toIso8601ZuluString(),
            'updated_at' => $card->updated_at?->toIso8601ZuluString(),
        ];
    }

    /** Moves the balance of a locked card by $cents and records it. */
    private function change(GiftCard $card, int $cents, string $note, ?int $orderId = null, ?int $creditMemoId = null, ?Admin $admin = null): void
    {
        $card->forceFill(['balance' => Pricing::format(Pricing::toCents($card->balance) + $cents)])->save();
        $this->record($card, $cents, $note, $orderId, $creditMemoId, $admin);
    }

    private function record(GiftCard $card, int $cents, string $note, ?int $orderId = null, ?int $creditMemoId = null, ?Admin $admin = null): void
    {
        GiftCardTransaction::create([
            'gift_card_id' => $card->id,
            'order_id' => $orderId,
            'credit_memo_id' => $creditMemoId,
            'admin_id' => $admin?->id,
            'amount' => Pricing::format($cents),
            'balance_after' => $card->balance,
            'note' => mb_substr($note, 0, 500),
        ]);
    }

    public static function senderName(Order $order): string
    {
        $address = $order->billing_address ?? $order->shipping_address ?? [];
        $name = trim(($address['first_name'] ?? '').' '.($address['last_name'] ?? ''));

        return $name !== '' ? $name : $order->email;
    }

    /** @param list<array{0: string, 1: Mailable}> $mails */
    public function sendAfterCommit(array $mails): void
    {
        if ($mails === []) {
            return;
        }
        DB::afterCommit(function () use ($mails) {
            foreach ($mails as [$to, $mail]) {
                try {
                    Mail::to($to)->send($mail);
                } catch (Throwable $e) {
                    report($e);
                }
            }
        });
    }

    /** "2027-01-31T00:00:00Z" → a date, or null. */
    public static function parseDate(?string $value): ?Carbon
    {
        return filled($value) ? Carbon::parse($value)->utc() : null;
    }
}
