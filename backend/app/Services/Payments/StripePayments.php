<?php

namespace App\Services\Payments;

use App\Mail\InvoiceMail;
use App\Mail\PaymentNotCompletedMail;
use App\Models\Admin;
use App\Models\Order;
use App\Services\AdminNotifications;
use App\Services\Audit;
use App\Services\OrderDocuments;
use App\Services\Pricing;
use App\Services\Settings;
use App\Support\Currency;
use Illuminate\Mail\Mailable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Phase 8: card payments through Stripe Checkout (Stripe's hosted payment
 * page; card details never reach BuyNest).
 *
 * 1. An order paid by card gets a Checkout Session for its grand total
 *    (startCheckout). The shopper pays on Stripe's page.
 * 2. Stripe tells us the result with a signed webhook (handleWebhook):
 *    paid → the invoice is created (OrderDocuments), as if staff had recorded
 *    the payment; the session expired unpaid → the order is cancelled
 *    (stock and coupon uses given back) and the customer is told.
 * 3. A credit memo on an order paid this way refunds the card (refund).
 *
 * Without STRIPE_SECRET_KEY none of this runs: card orders wait for staff to
 * invoice them, as before phase 8.
 */
class StripePayments
{
    public function __construct(
        private StripeGateway $gateway,
        private OrderDocuments $documents,
        private AdminNotifications $notifications,
        private Audit $audit,
        private Settings $settings,
    ) {}

    public function enabled(): bool
    {
        return $this->gateway->enabled();
    }

    /** Phase 12: for Settings → Payment methods: { status: live|test|not_configured, message }. */
    public function status(): array
    {
        $key = (string) config('buynest.stripe.secret_key');

        return match (true) {
            ! $this->enabled() => ['status' => 'not_configured', 'message' => 'Not configured: set STRIPE_SECRET_KEY'],
            str_starts_with($key, 'sk_live_') || str_starts_with($key, 'rk_live_') => ['status' => 'live', 'message' => 'Live'],
            default => ['status' => 'test', 'message' => 'Test mode'],
        };
    }

    /** For GET /api/v1/store: "stripe" (pay online) or "manual" (staff invoice card orders). */
    public function cardPayments(): string
    {
        return $this->enabled() ? 'stripe' : 'manual';
    }

    /** A card order, with Stripe on. */
    public function usesStripe(Order $order): bool
    {
        return $order->payment_method === 'card' && $this->enabled();
    }

    /** Whether the order can be paid online now: a card order, not paid, not cancelled (still waiting for the payment). */
    public function canPay(Order $order): bool
    {
        return $this->usesStripe($order) && $order->payment_status === 'unpaid' && $order->status === 'pending_payment';
    }

    /** Why $order can't be paid online (for the 422), or null when it can. */
    public function payProblem(Order $order): ?string
    {
        return match (true) {
            ! $this->enabled() => __('Online card payments aren\'t available right now. We\'ll contact you about the payment.'),
            $order->payment_method !== 'card' => __('This order isn\'t paid by card.'),
            $order->payment_status !== 'unpaid' => __('This order has already been paid.'),
            $order->status === 'cancelled' => __('This order was cancelled, so it can\'t be paid.'),
            $order->status !== 'pending_payment' => __('This order isn\'t waiting for a payment.'),
            default => null,
        };
    }

    /**
     * Opens a payment page for $order (or gives back the one still open):
     * { provider: "stripe", url, expires_at } or, when Stripe can't be
     * reached / refuses, { provider: "stripe", url: null, expires_at: null, error }.
     * The order itself never changes state here: it stays unpaid either way.
     *
     * $forAdmin: a payment link staff send (open for Stripe's 24-hour maximum).
     */
    public function startCheckout(Order $order, bool $forAdmin = false): array
    {
        // The row stays locked while Stripe answers (at most the timeout), so two
        // clicks at once can't open two payment pages for the same order.
        return DB::transaction(function () use ($order, $forAdmin) {
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            if ($this->hasOpenSession($order)) {
                return $this->openSession($order);
            }

            // Counted before the call: each try has its own idempotency key, so a retry after a
            // timeout never reuses a key with different parameters (Stripe refuses that).
            $attempt = $order->payment_attempts + 1;
            $order->forceFill(['payment_provider' => 'stripe', 'payment_attempts' => $attempt])->save();

            $minutes = (int) config($forAdmin ? 'buynest.stripe.admin_link_minutes' : 'buynest.stripe.checkout_minutes');
            $expiresAt = now()->addMinutes($minutes);
            $page = config('buynest.storefront_url').'/order-confirmation/'.rawurlencode($order->number);
            // Phase 10 (part B): a gift card may have paid part of it; Stripe charges the rest.
            $cents = $order->dueCents();

            try {
                $session = $this->gateway->createCheckoutSession([
                    'mode' => 'payment',
                    'line_items' => [[
                        'quantity' => 1,
                        'price_data' => [
                            'currency' => strtolower($order->currencyCode()), // phase 12: the order's (= store) currency
                            'unit_amount' => $cents,
                            'product_data' => ['name' => $this->settings->get('store_name')." order {$order->number}"],
                        ],
                    ]],
                    'customer_email' => $order->email,
                    'client_reference_id' => $order->number,
                    'metadata' => ['order_number' => $order->number],
                    'payment_intent_data' => ['metadata' => ['order_number' => $order->number]],
                    'expires_at' => $expiresAt->getTimestamp(),
                    'success_url' => "{$page}?payment=success",
                    'cancel_url' => "{$page}?payment=cancelled",
                ], "order-{$order->id}-session-{$attempt}");
            } catch (StripeException $e) {
                return ['provider' => 'stripe', 'url' => null, 'expires_at' => null, 'error' => __($e->getMessage())];
            }

            $order->forceFill([
                'payment_session_id' => $session['id'] ?? null,
                'payment_url' => $session['url'] ?? null,
                'payment_expires_at' => isset($session['expires_at']) ? now()->setTimestamp((int) $session['expires_at']) : $expiresAt,
            ])->save();

            return $this->openSession($order);
        });
    }

    /**
     * The order's payment, for the order answers:
     * { provider, paid_at, url (open payment page, else null), expires_at, can_pay }
     * Staff also get reference (the PaymentIntent id) and dashboard_url.
     */
    public function summary(Order $order, bool $forStaff): array
    {
        $open = $this->canPay($order) && $this->hasOpenSession($order);
        $summary = [
            'provider' => $order->payment_provider,
            'paid_at' => $order->paid_at?->toIso8601ZuluString(),
            'url' => $open ? $order->payment_url : null,
            'expires_at' => $open ? $order->payment_expires_at?->toIso8601ZuluString() : null,
            'can_pay' => $this->canPay($order),
        ];
        if ($forStaff) {
            $summary['reference'] = $order->payment_reference;
            $summary['dashboard_url'] = $order->payment_reference ? $this->dashboardUrl($order->payment_reference) : null;
        }

        return $summary;
    }

    /**
     * Closes the order's open payment page (an order cancelled by staff must not
     * be paid any more). Best effort: if Stripe can't be reached the page closes
     * by itself when it expires (and a payment for a cancelled order raises a
     * critical admin notification).
     */
    public function expireOpenSession(Order $order): void
    {
        if (! $this->enabled() || ! $this->hasOpenSession($order)) {
            return;
        }
        try {
            $this->gateway->expireCheckoutSession($order->payment_session_id, "order-{$order->id}-expire-{$order->payment_session_id}");
        } catch (StripeException $e) {
            report($e);
        }
        $order->forceFill(['payment_url' => null, 'payment_expires_at' => now()])->save();
    }

    /**
     * Refunds $cents to the card for a new credit memo on $order. Returns the
     * Stripe refund id, or null when the order wasn't paid through Stripe
     * (the money is returned by hand, as before). Stripe refusing throws a 422
     * ("Stripe refused the refund: …"), so the memo isn't saved.
     * Call inside the memo's transaction, with the order locked.
     */
    public function refund(Order $order, int $cents, int $memoNumber): ?string
    {
        if ($order->payment_provider !== 'stripe' || ! $order->payment_reference) {
            return null;
        }
        if (! $this->enabled()) {
            throw ValidationException::withMessages(['refund' => 'Stripe refused the refund: card payments through Stripe are not set up (STRIPE_SECRET_KEY is empty).']);
        }

        try {
            // Same order, same memo count, same amount → same key: a retry after a timeout can't refund twice.
            $refund = $this->gateway->createRefund($order->payment_reference, $cents,
                "memo-order-{$order->id}-{$memoNumber}-{$cents}", ['order_number' => $order->number]);
        } catch (StripeException $e) {
            throw ValidationException::withMessages(['refund' => 'Stripe refused the refund: '.$e->getMessage()]);
        }
        if (in_array($refund['status'] ?? null, ['failed', 'canceled'], true)) {
            throw ValidationException::withMessages(['refund' => 'Stripe refused the refund: its status is '.$refund['status'].'.']);
        }

        return $refund['id'] ?? null;
    }

    /**
     * A verified webhook event. Returns what was done ("duplicate", "paid",
     * "cancelled", "ignored", ...); the controller always answers 200 for a
     * valid event (Stripe retries anything else). Each event id is handled
     * once (payment_events); an exception rolls everything back, including the
     * event row, so Stripe's retry runs it again.
     */
    public function handleWebhook(array $event): string
    {
        $mail = null;
        $outcome = DB::transaction(function () use ($event, &$mail) {
            // Phase 10 (part B): payment_events (provider + event id) replaces stripe_events.
            if (! PaymentEvents::claim('stripe', $event['id'], $event['type'])) {
                return 'duplicate';
            }

            $session = $event['data']['object'] ?? null;
            $outcome = match ($event['type']) {
                'checkout.session.completed', 'checkout.session.async_payment_succeeded' => is_array($session)
                    ? $this->paid($session, $mail) : 'ignored',
                'checkout.session.expired' => is_array($session) ? $this->expired($session, $mail) : 'ignored',
                default => 'ignored',
            };
            PaymentEvents::processed('stripe', $event['id']);

            return $outcome;
        });

        // After the commit: a failed email must not undo the payment.
        if ($mail) {
            try {
                Mail::to($mail[0])->send($mail[1]);
            } catch (Throwable $e) {
                report($e);
            }
        }

        return $outcome;
    }

    /** @param array{0: string, 1: Mailable}|null $mail */
    private function paid(array $session, ?array &$mail): string
    {
        if (($session['payment_status'] ?? null) !== 'paid') {
            return 'awaiting_payment'; // a delayed method: async_payment_succeeded follows
        }
        $order = $this->orderFor($session);
        if (! $order) {
            return 'unknown_order';
        }

        $intent = is_array($session['payment_intent'] ?? null) ? ($session['payment_intent']['id'] ?? null) : ($session['payment_intent'] ?? null);
        $amount = (int) ($session['amount_total'] ?? -1);
        $currency = strtolower((string) ($session['currency'] ?? ''));
        $paidText = Currency::formatCents(max(0, $amount), $currency !== '' ? $currency : $order->currencyCode()).' '.strtoupper($currency);

        if ($order->payment_status !== 'unpaid' || $order->invoices()->exists()) {
            if ($order->payment_reference !== null && $order->payment_reference === $intent) {
                return 'already_paid';
            }
            $this->problem($order, "Order {$order->number} was paid again by card",
                "Stripe took a second payment ({$paidText}, {$intent}) for an order that was already paid. Refund it in the Stripe dashboard.");

            return 'already_paid';
        }
        if ($order->status === 'cancelled') {
            $this->problem($order, "Payment received for cancelled order {$order->number}",
                "Stripe took {$paidText} ({$intent}) after the order was cancelled. Refund it in the Stripe dashboard.");

            return 'cancelled_order';
        }
        if ($amount !== $order->dueCents() || $currency !== strtolower($order->currencyCode())) {
            Log::warning('Stripe payment does not match the order.', [
                'order' => $order->number, 'session' => $session['id'] ?? null, 'amount' => $amount, 'currency' => $currency,
                'expected_amount' => $order->dueCents(), 'expected_currency' => strtolower($order->currencyCode()),
            ]);
            $this->problem($order, "Payment amount mismatch on order {$order->number}",
                "Stripe reported {$paidText} ({$intent}) but the amount due is ".$order->money(Pricing::format($order->dueCents())).' '.$order->currencyCode()
                .'. The order was left unpaid: check the payment in the Stripe dashboard.');
            $order->history()->create([
                'status' => $order->status,
                'payment_status' => $order->payment_status,
                'note' => "Stripe reported a payment of {$paidText} that doesn't match the order total; the order was left unpaid.",
                'customer_notified' => false,
            ]);

            return 'amount_mismatch';
        }

        $order->forceFill([
            'payment_provider' => 'stripe',
            'payment_reference' => $intent,
            'payment_session_id' => $session['id'] ?? $order->payment_session_id,
            'payment_url' => null,
            'paid_at' => now(),
        ])->save();
        $invoice = $this->documents->invoice($order, null, 'Paid by card through Stripe.', true);
        $invoice->load(['order']);
        $mail = [$order->email, new InvoiceMail($invoice)];

        return 'paid';
    }

    /** @param array{0: string, 1: Mailable}|null $mail */
    private function expired(array $session, ?array &$mail): string
    {
        $order = $this->orderFor($session);
        if (! $order) {
            return 'unknown_order';
        }
        if ($order->payment_status !== 'unpaid' || $order->status !== 'pending_payment' || $order->payment_method !== 'card') {
            return 'ignored';
        }
        // A newer payment page was opened (Pay now): this old one expiring changes nothing.
        if (($session['id'] ?? null) === null || $order->payment_session_id !== $session['id']) {
            return 'superseded';
        }

        $order->forceFill(['payment_url' => null, 'payment_expires_at' => now()])->save();
        $this->documents->cancel($order, null, 'Payment not completed: the secure payment page expired. Order cancelled; items returned to stock.', true);
        $mail = [$order->email, new PaymentNotCompletedMail($order)];

        return 'cancelled';
    }

    private function orderFor(array $session): ?Order
    {
        $number = $session['metadata']['order_number'] ?? $session['client_reference_id'] ?? null;
        $order = is_string($number) && $number !== '' ? Order::where('number', strtoupper($number))->lockForUpdate()->first() : null;
        if (! $order) {
            Log::warning('Stripe webhook for an unknown order.', ['session' => $session['id'] ?? null, 'order_number' => $number]);
        }

        return $order;
    }

    private function problem(Order $order, string $title, string $body): void
    {
        $this->notifications->notify('payment_problem', "order:{$order->id}", $title, $body, "/orders/{$order->number}");
    }

    private function hasOpenSession(Order $order): bool
    {
        // Two minutes' margin: a page about to expire isn't worth sending someone to.
        return $order->payment_session_id && $order->payment_url && $order->payment_expires_at?->isAfter(now()->addMinutes(2));
    }

    private function openSession(Order $order): array
    {
        return ['provider' => 'stripe', 'url' => $order->payment_url, 'expires_at' => $order->payment_expires_at?->toIso8601ZuluString()];
    }

    /** The payment in Stripe's dashboard (test or live, from the key in use). */
    private function dashboardUrl(string $reference): string
    {
        $live = str_starts_with((string) config('buynest.stripe.secret_key'), 'sk_live_') || str_starts_with((string) config('buynest.stripe.secret_key'), 'rk_live_');

        return 'https://dashboard.stripe.com/'.($live ? '' : 'test/').'payments/'.rawurlencode($reference);
    }

    /** Staff opened a new payment link from the admin: audit entry. */
    public function recordLink(Order $order, Admin $admin, array $payment): void
    {
        if ($payment['url'] ?? null) {
            $this->audit->record('order.payment_link_created', "Payment link created for order {$order->number}.", 'order', $order->id,
                ['before' => [], 'after' => ['expires_at' => $payment['expires_at']]], $admin);
        }
    }
}
