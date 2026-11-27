<?php

namespace App\Services\Sms;

use App\Mail\CodConfirmedMail;
use App\Mail\OrderStatusMail;
use App\Models\Order;
use App\Services\Audit;
use App\Services\OrderDocuments;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Phase 20: the one-tap confirmation link of a cash on delivery order
 * ({storefront}/c/{token}, in the cod_confirm_request text). The order keeps
 * only the token's SHA-256 and its expiry (72 hours).
 *
 * - Looking at it (GET) never changes anything: link previews and SMS apps
 *   open links on their own.
 * - confirm: what staff choosing "confirmed" at the phone confirmation does
 *   (log, history, CodConfirmedMail, order_confirmed text), by the customer.
 * - cancel: what the confirmation outcome "cancelled" does (restock, cancel
 *   email, order_cancelled text), only while the order can still be
 *   cancelled (not shipped, not invoiced).
 * - After either the link only shows the result: confirmation_status is no
 *   longer pending/unreachable, so it can't be used again.
 */
class ConfirmLinks
{
    public const CONFIRMED_NOTE = 'Confirmed by the customer from the SMS link';

    public const CANCELLED_NOTE = 'Cancelled by the customer from the SMS link';

    public const ACTOR = 'Customer (SMS link)';

    public function __construct(private OrderDocuments $documents, private Audit $audit, private Sms $sms) {}

    /** The order of a token (expired or not), or null for an unknown token. */
    public function find(string $token): ?Order
    {
        return strlen($token) < 20 ? null : Order::where('sms_confirm_token_hash', hash('sha256', $token))->first();
    }

    public static function expired(Order $order): bool
    {
        return $order->sms_confirm_expires_at === null || $order->sms_confirm_expires_at->isPast();
    }

    /** pending | confirmed | cancelled | expired | not_waiting (a result shows even after the expiry). */
    public static function status(Order $order): string
    {
        return match (true) {
            $order->status === 'cancelled' => 'cancelled',
            $order->confirmation_status === 'confirmed' => 'confirmed',
            self::expired($order) => 'expired',
            self::waiting($order) => 'pending',
            default => 'not_waiting',
        };
    }

    /** Still waiting for its confirmation, and not shipped (a shipped-anyway order no longer needs it). */
    private static function waiting(Order $order): bool
    {
        return $order->awaitsConfirmation() && in_array($order->status, ['pending_payment', 'processing'], true);
    }

    /** { number, total, items_count, placed_at, status }: no address, phone or name. */
    public static function summary(Order $order): array
    {
        $order->loadMissing('items');

        return [
            'number' => $order->number,
            'total' => $order->grand_total,
            'items_count' => $order->itemCount(),
            'placed_at' => $order->placed_at?->toIso8601ZuluString(),
            'status' => self::status($order),
        ];
    }

    /**
     * confirm | cancel by the customer. 422 { errors: { token } } when the order isn't
     * waiting any more (or the cancel rules refuse it); the caller answers 404 for an
     * unknown or expired link first.
     */
    public function act(Order $order, string $action, ?string $reason = null): Order
    {
        $reason = filled($reason) ? mb_substr(trim((string) $reason), 0, 500) : null;

        $order = DB::transaction(function () use ($order, $action, $reason) {
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            if (self::status($order) !== 'pending') {
                throw ValidationException::withMessages(['token' => __('This order isn\'t waiting for a confirmation any more.')]);
            }
            $before = $order->confirmation_status;
            $note = $action === 'confirm' ? self::CONFIRMED_NOTE.'.' : self::CANCELLED_NOTE.($reason ? ": {$reason}" : '.');
            $outcome = $action === 'confirm' ? 'confirmed' : 'cancelled';
            $order->confirmationLogs()->create(['admin_id' => null, 'outcome' => $outcome, 'note' => $note]);
            $order->forceFill([
                'confirmation_status' => $outcome,
                'confirmation_attempts' => $order->confirmation_attempts + 1,
                ...($outcome === 'confirmed' ? ['confirmed_at' => now()] : []),
            ])->save();

            if ($outcome === 'cancelled') {
                try {
                    $this->documents->cancel($order, null, $note, true, actor: self::ACTOR);
                } catch (ValidationException $e) {
                    throw ValidationException::withMessages(['token' => __('This order can\'t be cancelled online any more. Please contact us.')]);
                }
            } else {
                $order->history()->create([
                    'status' => $order->status,
                    'payment_status' => $order->payment_status,
                    'note' => $note,
                    'admin_id' => null,
                    'actor' => self::ACTOR,
                    'customer_notified' => true,
                ]);
                $this->sms->sendForOrder($order, 'order_confirmed');
            }
            $this->audit->record('order.confirmation', "Order {$order->number} confirmation from the SMS link: {$outcome}.", 'order', $order->id,
                ['before' => ['confirmation_status' => $before], 'after' => ['confirmation_status' => $outcome, 'actor' => 'customer_sms_link', 'reason' => $reason]],
                anonymous: true);

            return $order;
        });

        try {
            Mail::to($order->email)->send($order->confirmation_status === 'confirmed' ? new CodConfirmedMail($order->load('items')) : new OrderStatusMail($order->refresh()));
        } catch (Throwable $e) {
            report($e); // the confirmation is saved either way
        }

        return $order->refresh();
    }
}
