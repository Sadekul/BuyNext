<?php

namespace App\Services\Payments;

use App\Mail\InvoiceMail;
use App\Mail\PaymentNotCompletedMail;
use App\Models\Admin;
use App\Models\CreditMemo;
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
 * Phase 10 (part B): PayPal payments, the same design as Stripe (phase 8).
 *
 * 1. An order paid with PayPal gets a PayPal order (Orders API v2, intent
 *    CAPTURE) for its amount due; the shopper approves it on PayPal's site
 *    (redirect, no PayPal script in the browser).
 * 2. Back on the confirmation page the storefront asks us to capture it
 *    (captureForShopper); we check status, amount, and currency, then invoice
 *    through OrderDocuments exactly like Stripe's webhook does.
 * 3. Webhooks (verified with PayPal's verify-webhook-signature API) catch a
 *    missed return trip, and refunds made in PayPal's dashboard.
 * 4. Unpaid PayPal orders are cancelled once their 3-hour approval window has
 *    passed (expireStale, scheduled), after asking PayPal one last time.
 * 5. A credit memo on an order paid this way refunds the capture (refund).
 *
 * Without PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET none of this runs: PayPal
 * orders wait for staff to invoice them, as before.
 */
class PayPalPayments
{
    public function __construct(
        private PayPalGateway $gateway,
        private OrderDocuments $documents,
        private AdminNotifications $notifications,
        private Audit $audit,
        private Settings $settings,
    ) {}

    /** New PayPal payments: credentials set, and (phase 12) PayPal accepts the store currency. */
    public function enabled(): bool
    {
        return $this->gateway->enabled() && Currency::paypalAccepts();
    }

    /** For GET /api/v1/store: "paypal" (pay online), "manual" (staff invoice PayPal orders), or (phase 12) "unavailable" (PayPal doesn't take the store currency). */
    public function paypalPayments(): string
    {
        return match (true) {
            ! Currency::paypalAccepts() => 'unavailable',
            $this->enabled() => 'paypal',
            default => 'manual',
        };
    }

    /** Phase 12: for Settings → Payment methods: { status: live|sandbox|not_configured|unavailable, message }. */
    public function status(): array
    {
        return match (true) {
            ! Currency::paypalAccepts() => ['status' => 'unavailable', 'message' => 'Not available in '.Currency::store()],
            ! $this->gateway->enabled() => ['status' => 'not_configured', 'message' => 'Not configured: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET'],
            $this->gateway->live() => ['status' => 'live', 'message' => 'Live'],
            default => ['status' => 'sandbox', 'message' => 'Sandbox'],
        };
    }

    public function usesPayPal(Order $order): bool
    {
        return $order->payment_method === 'paypal' && $this->enabled();
    }

    public function canPay(Order $order): bool
    {
        return $this->usesPayPal($order) && $order->payment_status === 'unpaid' && $order->status === 'pending_payment' && $order->dueCents() > 0;
    }

    /** Why $order can't be paid with PayPal now (for the 422), or null when it can. */
    public function payProblem(Order $order): ?string
    {
        return match (true) {
            ! Currency::paypalAccepts() => 'PayPal doesn\'t accept '.Currency::store().', so it isn\'t available in this store.', // phase 12
            ! $this->enabled() => 'Online PayPal payments aren\'t available right now. We\'ll contact you about the payment.',
            $order->payment_method !== 'paypal' => 'This order isn\'t paid with PayPal.',
            $order->payment_status !== 'unpaid' => 'This order has already been paid.',
            $order->status === 'cancelled' => 'This order was cancelled, so it can\'t be paid.',
            $order->status !== 'pending_payment' => 'This order isn\'t waiting for a payment.',
            default => null,
        };
    }

    /**
     * Opens a PayPal approval page for $order (or gives back the one still
     * open): { provider: "paypal", url, expires_at }, or url null + error
     * when PayPal can't be reached / refuses. The order stays unpaid either way.
     */
    public function startCheckout(Order $order, bool $forAdmin = false): array
    {
        return DB::transaction(function () use ($order) {
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            if ($this->hasOpenSession($order)) {
                return $this->openSession($order);
            }

            $attempt = $order->payment_attempts + 1;
            $order->forceFill(['payment_provider' => 'paypal', 'payment_attempts' => $attempt])->save();

            // PayPal's approval link is valid for 3 hours, for staff links too.
            $expiresAt = now()->addMinutes((int) config('buynest.paypal.approval_minutes'));
            $page = config('buynest.storefront_url').'/order-confirmation/'.rawurlencode($order->number);
            $storeName = (string) $this->settings->get('store_name');

            try {
                $paypalOrder = $this->gateway->createOrder([
                    'intent' => 'CAPTURE',
                    'purchase_units' => [[
                        'reference_id' => $order->number,
                        'custom_id' => $order->number,
                        'description' => mb_substr("{$storeName} order {$order->number}", 0, 127),
                        'amount' => ['currency_code' => $order->currencyCode(), 'value' => Pricing::format($order->dueCents())],
                    ]],
                    'payment_source' => ['paypal' => ['experience_context' => [
                        'brand_name' => mb_substr($storeName, 0, 127),
                        'user_action' => 'PAY_NOW',
                        'shipping_preference' => 'NO_SHIPPING',
                        'return_url' => "{$page}?payment=success&provider=paypal",
                        'cancel_url' => "{$page}?payment=cancelled&provider=paypal",
                    ]]],
                ], "order-{$order->id}-paypal-{$attempt}");
            } catch (PayPalException $e) {
                return ['provider' => 'paypal', 'url' => null, 'expires_at' => null, 'error' => $e->getMessage()];
            }

            $approve = collect($paypalOrder['links'] ?? [])->first(fn ($link) => in_array($link['rel'] ?? null, ['payer-action', 'approve'], true));
            if (! is_string($paypalOrder['id'] ?? null) || ! is_string($approve['href'] ?? null)) {
                Log::warning('PayPal created an order without an approval link.', ['order' => $order->number, 'paypal_order' => $paypalOrder['id'] ?? null]);

                return ['provider' => 'paypal', 'url' => null, 'expires_at' => null, 'error' => 'PayPal could not start the payment. Please try again in a moment.'];
            }

            $order->forceFill([
                'payment_session_id' => $paypalOrder['id'],
                'payment_url' => $approve['href'],
                'payment_expires_at' => $expiresAt,
            ])->save();

            return $this->openSession($order);
        });
    }

    /** The order's payment for the order answers (see StripePayments::summary); staff also get the capture id and its PayPal page. */
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
            $summary['dashboard_url'] = $order->payment_provider === 'paypal' && $order->payment_reference
                ? 'https://www.'.($this->gateway->live() ? '' : 'sandbox.').'paypal.com/activity/payment/'.rawurlencode($order->payment_reference)
                : null;
        }

        return $summary;
    }

    /** Staff cancelled the order: forget its approval link (PayPal orders can't be closed; a late payment raises a notification). */
    public function expireOpenSession(Order $order): void
    {
        if ($order->payment_provider === 'paypal' && $order->payment_url) {
            $order->forceFill(['payment_url' => null, 'payment_expires_at' => now()])->save();
        }
    }

    /**
     * POST /orders/{number}/paypal/capture: the shopper is back from PayPal
     * with ?token=<PayPal order id>. Captures it and records the payment.
     * Returns [result ("paid" | "already_paid"), order]; throws a 422 (key
     * "payment") when it can't be done.
     */
    public function captureForShopper(Order $order, string $token): array
    {
        $mail = null;
        [$outcome, $error] = DB::transaction(function () use ($order, $token, &$mail) {
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            $samePayPalOrder = $order->payment_session_id !== null && hash_equals($order->payment_session_id, $token);
            if ($order->payment_status !== 'unpaid') {
                return $samePayPalOrder && $order->payment_provider === 'paypal' && $order->payment_reference
                    ? ['already_paid', null] : [null, 'This order has already been paid.'];
            }
            if ($problem = $this->payProblem($order)) {
                return [null, $problem];
            }
            if (! $samePayPalOrder) {
                return [null, 'This PayPal payment doesn\'t belong to this order.'];
            }

            try {
                $outcome = $this->captureLocked($order, $mail);
            } catch (PayPalException $e) {
                return [null, $e->unreachable ? $e->getMessage() : 'PayPal declined the payment: '.rtrim($e->getMessage(), '.').'. You can try again with Pay now.'];
            }

            return match ($outcome) {
                'paid', 'already_paid' => [$outcome, null],
                'pending' => [null, 'PayPal is still processing this payment. We\'ll email you as soon as it\'s confirmed.'],
                'declined' => [null, 'PayPal declined the payment. You can try again with Pay now.'],
                default => [null, 'We couldn\'t confirm this payment. Our team has been told and will contact you.'],
            };
        });

        $this->send($mail);
        if ($error) {
            throw ValidationException::withMessages(['payment' => $error]);
        }

        return [$outcome, $order->refresh()];
    }

    /**
     * Refunds $cents of the capture for a new credit memo on $order. Returns
     * the PayPal refund id, or null when the order wasn't paid through PayPal.
     * PayPal refusing throws a 422 ("PayPal refused the refund: …").
     * Call inside the memo's transaction, with the order locked.
     */
    public function refund(Order $order, int $cents, int $memoNumber): ?string
    {
        if ($order->payment_provider !== 'paypal' || ! $order->payment_reference) {
            return null;
        }
        if (! $this->gateway->enabled()) { // phase 12: old PayPal orders can still be refunded after a currency switch
            throw ValidationException::withMessages(['refund' => 'PayPal refused the refund: PayPal payments are not set up (PAYPAL_CLIENT_ID is empty).']);
        }

        try {
            $refund = $this->gateway->refundCapture($order->payment_reference, Pricing::format($cents),
                "memo-order-{$order->id}-{$memoNumber}-{$cents}", "Refund for order {$order->number}", $order->currencyCode());
        } catch (PayPalException $e) {
            throw ValidationException::withMessages(['refund' => 'PayPal refused the refund: '.$e->getMessage()]);
        }
        if (in_array($refund['status'] ?? null, ['FAILED', 'CANCELLED'], true)) {
            throw ValidationException::withMessages(['refund' => 'PayPal refused the refund: its status is '.$refund['status'].'.']);
        }

        return $refund['id'] ?? null;
    }

    /**
     * A verified webhook event. Returns what was done; each event id is
     * handled once (payment_events, provider "paypal"). An exception rolls
     * everything back, including the event row, so PayPal's retry runs it again.
     */
    public function handleWebhook(array $event): string
    {
        $mail = null;
        $outcome = DB::transaction(function () use ($event, &$mail) {
            if (! PaymentEvents::claim('paypal', $event['id'], $event['event_type'])) {
                return 'duplicate';
            }
            $resource = is_array($event['resource'] ?? null) ? $event['resource'] : [];
            $outcome = match ($event['event_type']) {
                'PAYMENT.CAPTURE.COMPLETED' => $this->captureCompleted($resource, $mail),
                'CHECKOUT.ORDER.APPROVED' => $this->orderApproved($resource, $mail),
                'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED' => $this->refundedOutside($event['event_type'], $resource),
                default => 'ignored',
            };
            PaymentEvents::processed('paypal', $event['id']);

            return $outcome;
        });
        $this->send($mail);

        return $outcome;
    }

    /**
     * Cancels unpaid PayPal orders whose approval window has passed (the
     * scheduled buynest:payments:expire-paypal). PayPal is asked first: a
     * payment that was completed or approved meanwhile is recorded instead.
     *
     * @return array<string, int> outcome => count
     */
    public function expireStale(): array
    {
        $ids = Order::where('payment_method', 'paypal')->where('payment_provider', 'paypal')
            ->where('payment_status', 'unpaid')->where('status', 'pending_payment')
            ->whereNotNull('payment_expires_at')->where('payment_expires_at', '<', now())
            ->orderBy('id')->limit(500)->pluck('id');

        $counts = [];
        foreach ($ids as $id) {
            try {
                $outcome = $this->expireOne($id);
            } catch (Throwable $e) {
                report($e);
                $outcome = 'failed';
            }
            $counts[$outcome] = ($counts[$outcome] ?? 0) + 1;
        }

        return $counts;
    }

    private function expireOne(int $id): string
    {
        $mail = null;
        $outcome = DB::transaction(function () use ($id, &$mail) {
            $order = Order::whereKey($id)->lockForUpdate()->first();
            // Checked again under the lock: paid, cancelled, or given a new link meanwhile → nothing to do.
            if (! $order || $order->payment_status !== 'unpaid' || $order->status !== 'pending_payment'
                || $order->payment_method !== 'paypal' || ! $order->payment_expires_at?->isPast()) {
                return 'skipped';
            }

            if ($this->gateway->enabled() && $order->payment_session_id) {
                try {
                    $paypalOrder = $this->gateway->getOrder($order->payment_session_id);
                    if (($paypalOrder['status'] ?? null) === 'COMPLETED' && ($capture = $this->captureOf($paypalOrder))) {
                        return $this->record($order, $capture, $mail);
                    }
                    if (($paypalOrder['status'] ?? null) === 'APPROVED') {
                        $outcome = $this->captureLocked($order, $mail);
                        if (in_array($outcome, ['paid', 'pending', 'amount_mismatch'], true)) {
                            return $outcome;
                        }
                    }
                } catch (PayPalException $e) {
                    if ($e->unreachable) {
                        return 'skipped'; // asked again on the next run
                    }
                    // Not found / refused: the approval never completed.
                }
            }

            $order->forceFill(['payment_url' => null])->save();
            $this->documents->cancel($order, null, 'Payment not completed: the PayPal payment window expired. Order cancelled; items returned to stock.', true);
            $mail = [$order->email, new PaymentNotCompletedMail($order)];

            return 'cancelled';
        });
        $this->send($mail);

        return $outcome;
    }

    /** Captures the order's current PayPal order (the order is locked and unpaid). */
    private function captureLocked(Order $order, ?array &$mail): string
    {
        $paypalOrderId = (string) $order->payment_session_id;
        try {
            $paypalOrder = $this->gateway->captureOrder($paypalOrderId, "capture-{$paypalOrderId}");
        } catch (PayPalException $e) {
            if ($e->issue !== 'ORDER_ALREADY_CAPTURED') {
                throw $e;
            }
            $paypalOrder = $this->gateway->getOrder($paypalOrderId);
        }

        $capture = $this->captureOf($paypalOrder);
        if (! $capture) {
            Log::warning('PayPal capture answer without a capture.', ['order' => $order->number, 'paypal_order' => $paypalOrderId, 'status' => $paypalOrder['status'] ?? null]);

            return 'declined';
        }

        return $this->record($order, $capture, $mail);
    }

    /** purchase_units[0].payments.captures[0] of a PayPal order, or null. */
    private function captureOf(array $paypalOrder): ?array
    {
        $capture = $paypalOrder['purchase_units'][0]['payments']['captures'][0] ?? null;

        return is_array($capture) ? $capture : null;
    }

    /**
     * Records a capture on the (locked) order: checks it is completed and for
     * the amount due in the store currency, then invoices the order.
     *
     * @param  array{0: string, 1: Mailable}|null  $mail
     */
    private function record(Order $order, array $capture, ?array &$mail): string
    {
        $captureId = is_string($capture['id'] ?? null) ? $capture['id'] : null;
        $status = $capture['status'] ?? null;
        $amount = Pricing::toCents((string) ($capture['amount']['value'] ?? '-0.01'));
        $currency = strtoupper((string) ($capture['amount']['currency_code'] ?? ''));
        $paidText = Currency::formatCents(max(0, $amount), $currency ?: $order->currencyCode()).' '.$currency;

        if ($order->payment_status !== 'unpaid' || $order->invoices()->exists()) {
            if ($order->payment_reference !== null && $order->payment_reference === $captureId) {
                return 'already_paid';
            }
            $this->problem($order, "Order {$order->number} was paid again with PayPal",
                "PayPal took a second payment ({$paidText}, capture {$captureId}) for an order that was already paid. Refund it in the PayPal dashboard.");

            return 'already_paid';
        }
        if ($order->status === 'cancelled') {
            $this->problem($order, "Payment received for cancelled order {$order->number}",
                "PayPal took {$paidText} (capture {$captureId}) after the order was cancelled. Refund it in the PayPal dashboard.");

            return 'cancelled_order';
        }
        if ($status === 'PENDING') {
            return 'pending'; // e.g. an eCheck: PAYMENT.CAPTURE.COMPLETED follows
        }
        if ($status !== 'COMPLETED' || $captureId === null) {
            return 'declined';
        }
        if ($amount !== $order->dueCents() || $currency !== $order->currencyCode()) { // phase 12: the order's currency
            Log::warning('PayPal payment does not match the order.', [
                'order' => $order->number, 'capture' => $captureId, 'amount' => $amount, 'currency' => $currency,
                'expected_amount' => $order->dueCents(), 'expected_currency' => $order->currencyCode(),
            ]);
            $this->problem($order, "Payment amount mismatch on order {$order->number}",
                "PayPal reported {$paidText} (capture {$captureId}) but the amount due is ".$order->money(Pricing::format($order->dueCents())).' '.$order->currencyCode()
                .'. The order was left unpaid: check the payment in the PayPal dashboard.');
            $order->history()->create([
                'status' => $order->status,
                'payment_status' => $order->payment_status,
                'note' => "PayPal reported a payment of {$paidText} that doesn't match the amount due; the order was left unpaid.",
                'customer_notified' => false,
            ]);

            return 'amount_mismatch';
        }

        $order->forceFill([
            'payment_provider' => 'paypal',
            'payment_reference' => $captureId,
            'payment_url' => null,
            'paid_at' => now(),
        ])->save();
        $invoice = $this->documents->invoice($order, null, 'Paid through PayPal.', true);
        $invoice->load(['order']);
        $mail = [$order->email, new InvoiceMail($invoice)];

        return 'paid';
    }

    /** PAYMENT.CAPTURE.COMPLETED: the capture, for an order whose return trip may have been missed. */
    private function captureCompleted(array $capture, ?array &$mail): string
    {
        $order = $this->orderFor($capture['custom_id'] ?? null, $capture['supplementary_data']['related_ids']['order_id'] ?? null);

        return $order ? $this->record($order, $capture, $mail) : 'unknown_order';
    }

    /** CHECKOUT.ORDER.APPROVED: the shopper approved but we haven't captured yet. */
    private function orderApproved(array $paypalOrder, ?array &$mail): string
    {
        $order = $this->orderFor($paypalOrder['purchase_units'][0]['custom_id'] ?? null, $paypalOrder['id'] ?? null);
        if (! $order) {
            return 'unknown_order';
        }
        if ($order->payment_status !== 'unpaid') {
            return 'already_paid';
        }
        if ($order->status !== 'pending_payment' || $order->payment_method !== 'paypal' || $order->payment_session_id !== ($paypalOrder['id'] ?? null)) {
            return 'ignored'; // cancelled, or an older PayPal order (Pay now opened a new one)
        }

        try {
            return $this->captureLocked($order, $mail);
        } catch (PayPalException $e) {
            if ($e->unreachable) {
                throw $e; // rolled back, PayPal retries the event
            }

            return 'capture_failed';
        }
    }

    /** PAYMENT.CAPTURE.REFUNDED / REVERSED: our own refunds are known; anything else is flagged for staff. */
    private function refundedOutside(string $type, array $refund): string
    {
        if (is_string($refund['id'] ?? null) && CreditMemo::where('refund_reference', $refund['id'])->exists()) {
            return 'ignored';
        }
        $captureId = null;
        foreach ($refund['links'] ?? [] as $link) {
            if (($link['rel'] ?? null) === 'up' && is_string($link['href'] ?? null) && str_contains($link['href'], '/captures/')) {
                $captureId = basename(parse_url($link['href'], PHP_URL_PATH) ?: '');
            }
        }
        // A reversal's resource can be the capture itself.
        $captureId ??= $type === 'PAYMENT.CAPTURE.REVERSED' && is_string($refund['id'] ?? null) ? $refund['id'] : null;
        $order = $captureId ? Order::where('payment_provider', 'paypal')->where('payment_reference', $captureId)->first() : null;
        $order ??= is_string($refund['custom_id'] ?? null) ? Order::where('number', strtoupper($refund['custom_id']))->first() : null;
        if (! $order) {
            Log::warning('PayPal refund webhook for an unknown order.', ['type' => $type, 'refund' => $refund['id'] ?? null, 'capture' => $captureId]);

            return 'unknown_order';
        }

        $what = $type === 'PAYMENT.CAPTURE.REVERSED' ? 'reversed' : 'refunded';
        $amount = isset($refund['amount']['value']) ? Currency::format($refund['amount']['value'], $refund['amount']['currency_code'] ?? $order->currencyCode()).' '.($refund['amount']['currency_code'] ?? '') : 'Money';
        $this->problem($order, "PayPal payment {$what} for order {$order->number}",
            "{$amount} was {$what} in PayPal outside BuyNest (".($refund['id'] ?? 'no id').'). '
            .'If the money went back to the customer, record a credit memo (refund) on the order so the books match.');

        return 'refund_noted';
    }

    private function orderFor(?string $number, ?string $paypalOrderId): ?Order
    {
        $order = is_string($number) && $number !== '' ? Order::where('number', strtoupper($number))->lockForUpdate()->first() : null;
        $order ??= is_string($paypalOrderId) && $paypalOrderId !== ''
            ? Order::where('payment_session_id', $paypalOrderId)->lockForUpdate()->first() : null;
        if (! $order) {
            Log::warning('PayPal webhook for an unknown order.', ['order_number' => $number, 'paypal_order' => $paypalOrderId]);
        }

        return $order;
    }

    private function problem(Order $order, string $title, string $body): void
    {
        $this->notifications->notify('payment_problem', "order:{$order->id}", $title, $body, "/orders/{$order->number}");
    }

    private function hasOpenSession(Order $order): bool
    {
        return $order->payment_provider === 'paypal' && $order->payment_session_id && $order->payment_url
            && $order->payment_expires_at?->isAfter(now()->addMinutes(2));
    }

    private function openSession(Order $order): array
    {
        return ['provider' => 'paypal', 'url' => $order->payment_url, 'expires_at' => $order->payment_expires_at?->toIso8601ZuluString()];
    }

    /** After the commit: a failed email must not undo the payment. */
    private function send(?array $mail): void
    {
        if ($mail) {
            try {
                Mail::to($mail[0])->send($mail[1]);
            } catch (Throwable $e) {
                report($e);
            }
        }
    }

    /** Staff opened a new payment link from the admin: audit entry. */
    public function recordLink(Order $order, Admin $admin, array $payment): void
    {
        if ($payment['url'] ?? null) {
            $this->audit->record('order.payment_link_created', "PayPal payment link created for order {$order->number}.", 'order', $order->id,
                ['before' => [], 'after' => ['expires_at' => $payment['expires_at']]], $admin);
        }
    }
}
