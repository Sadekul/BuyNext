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
use App\Services\Sms\Sms;
use App\Support\Currency;
use Illuminate\Mail\Mailable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Phase 12: SSLCommerz payments (bKash, Nagad, Rocket, Upay, cards,
 * internet banking), the same design as Stripe (phase 8) and PayPal (phase 10).
 *
 * 1. An SSLCommerz order gets a payment session for its amount due
 *    (startCheckout); every start is a new attempt, tran_id "<number>-<n>".
 * 2. SSLCommerz sends the shopper back with a form POST to the store's
 *    sign-in service, which forwards it here (handleReturn). The posted status
 *    is never trusted: val_id is checked with the validation API first.
 * 3. The IPN (handleIpn) catches a missed return trip.
 * 4. A validated payment is checked (status, tran_id of one of the order's
 *    attempts, currency, amount due to the cent) and invoiced through
 *    OrderDocuments; risk level 1 holds it for staff (payment status "review").
 * 5. Unpaid orders are cancelled once their session window has passed
 *    (expireStale, scheduled), after asking SSLCommerz about every attempt.
 * 6. Staff "Check payment" (check) asks the same; credit memos refund
 *    through SSLCommerz's refund API (refund).
 *
 * Without SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASSWORD (in a taka store)
 * SSLCommerz orders wait for staff to invoice them, like other manual methods.
 */
class SslCommerzPayments
{
    /** Outcomes after which the shopper sees the "payment received" confirmation. */
    public const SUCCESS_OUTCOMES = ['paid', 'already_paid', 'review', 'pending'];

    public function __construct(
        private SslCommerzGateway $gateway,
        private OrderDocuments $documents,
        private AdminNotifications $notifications,
        private Audit $audit,
        private Settings $settings,
    ) {}

    public function enabled(): bool
    {
        return $this->gateway->enabled();
    }

    /** For GET /api/v1/store: "sslcommerz" (pay online), "manual" (staff invoice them), "unavailable" (store currency isn't BDT). */
    public function sslcommerzPayments(): string
    {
        return match (true) {
            ! Currency::sslcommerzAccepts() => 'unavailable',
            $this->enabled() => 'sslcommerz',
            default => 'manual',
        };
    }

    /** For Settings → Payment methods: { status: live|sandbox|not_configured|unavailable, message }. */
    public function status(): array
    {
        return match (true) {
            ! Currency::sslcommerzAccepts() => ['status' => 'unavailable', 'message' => 'Needs the store currency BDT'],
            ! $this->gateway->configured() => ['status' => 'not_configured', 'message' => 'Not configured: set SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD'],
            $this->gateway->live() => ['status' => 'live', 'message' => 'Live'],
            default => ['status' => 'sandbox', 'message' => 'Sandbox'],
        };
    }

    public function usesSslCommerz(Order $order): bool
    {
        // Phase 14: a cash on delivery order's advance (delivery charge + fee) is paid through SSLCommerz too.
        return ($order->payment_method === 'sslcommerz' || $order->hasAdvance()) && $this->enabled();
    }

    public function canPay(Order $order): bool
    {
        return $this->usesSslCommerz($order) && $this->payProblem($order) === null;
    }

    /** Why $order can't be paid through SSLCommerz now (for the 422), or null when it can. */
    public function payProblem(Order $order): ?string
    {
        return match (true) {
            ! $this->enabled() => __('Online payments through SSLCommerz aren\'t available right now. We\'ll contact you about the payment.'),
            $order->payment_method !== 'sslcommerz' && ! $order->hasAdvance() => __('This order isn\'t paid through SSLCommerz.'),
            $order->payment_status === 'review' => __('This order\'s payment was received and is being checked.'),
            $order->payment_status !== 'unpaid' => __('This order has already been paid.'),
            $order->status === 'cancelled' => __('This order was cancelled, so it can\'t be paid.'),
            $order->status !== 'pending_payment' => __('This order isn\'t waiting for a payment.'),
            ! Currency::sslcommerzAccepts($order->currencyCode()) => __('This order is in :currency; SSLCommerz charges in BDT only.', ['currency' => $order->currencyCode()]),
            blank($order->phone) => 'SSLCommerz needs a phone number for this order. Contact us to add one.',
            $order->onlineDueCents() <= 0 => __('There is nothing left to pay on this order.'),
            default => null,
        };
    }

    /**
     * Opens a new SSLCommerz payment page for $order (a new attempt each
     * time): { provider: "sslcommerz", url, expires_at }, or url null + error
     * when SSLCommerz can't be reached / refuses. The order stays unpaid either way.
     */
    public function startCheckout(Order $order, bool $forAdmin = false): array
    {
        return DB::transaction(function () use ($order, $forAdmin) {
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            $order->loadMissing('items');
            $attempt = $order->payment_attempts + 1;
            $order->forceFill(['payment_provider' => 'sslcommerz', 'payment_attempts' => $attempt])->save();
            $tranId = self::tranId($order, $attempt);

            $minutes = (int) config($forAdmin ? 'buynest.sslcommerz.admin_link_minutes' : 'buynest.sslcommerz.session_minutes');
            $store = config('buynest.storefront_url');
            $billing = $order->billing_address ?: $order->shipping_address ?: [];
            $shipping = $order->shipping_address ?: [];
            $ships = $order->items->contains(fn ($item) => ! $item->isGiftCard());
            $names = $order->items->map(fn ($item) => $item->name)->unique()->implode(', ');

            try {
                $session = $this->gateway->createSession(array_filter([
                    'total_amount' => Pricing::format($order->onlineDueCents()), // phase 14: a COD order's advance only
                    'currency' => $order->currencyCode(),
                    'tran_id' => $tranId,
                    // The shopper's browser comes back with a form POST to the store's sign-in service (BFF), which forwards it here.
                    'success_url' => "{$store}/api/payments/sslcommerz/return/success",
                    'fail_url' => "{$store}/api/payments/sslcommerz/return/fail",
                    'cancel_url' => "{$store}/api/payments/sslcommerz/return/cancel",
                    'ipn_url' => "{$store}/api/payments/sslcommerz/ipn",
                    'cus_name' => self::clip(trim(($billing['first_name'] ?? '').' '.($billing['last_name'] ?? '')) ?: $order->email, 50),
                    'cus_email' => $order->email,
                    'cus_add1' => self::clip($billing['line1'] ?? '', 50),
                    'cus_add2' => self::clip($billing['line2'] ?? '', 50),
                    'cus_city' => self::clip($billing['city'] ?? '', 50),
                    'cus_state' => self::clip($billing['state'] ?? '', 50),
                    'cus_postcode' => self::clip($billing['postal_code'] ?? '', 30),
                    'cus_country' => self::clip($billing['country'] ?? '', 50),
                    'cus_phone' => self::clip((string) $order->phone, 20),
                    'shipping_method' => $ships ? 'YES' : 'NO',
                    ...($ships ? [
                        'num_of_item' => $order->itemCount(),
                        'ship_name' => self::clip(trim(($shipping['first_name'] ?? '').' '.($shipping['last_name'] ?? '')), 50),
                        'ship_add1' => self::clip($shipping['line1'] ?? '', 50),
                        'ship_add2' => self::clip($shipping['line2'] ?? '', 50),
                        'ship_city' => self::clip($shipping['city'] ?? '', 50),
                        'ship_state' => self::clip($shipping['state'] ?? '', 50),
                        'ship_postcode' => self::clip($shipping['postal_code'] ?? '', 50),
                        'ship_country' => self::clip($shipping['country'] ?? '', 50),
                    ] : ['num_of_item' => $order->itemCount()]),
                    'product_name' => self::clip($names !== '' ? $names : "Order {$order->number}", 255),
                    'product_category' => $ships ? 'General' : 'Gift card',
                    'product_profile' => 'general',
                    'value_a' => $order->number,
                    'value_b' => (string) $attempt,
                ], fn ($value) => $value !== null && $value !== ''));
            } catch (SslCommerzException $e) {
                return ['provider' => 'sslcommerz', 'url' => null, 'expires_at' => null, 'error' => __($e->getMessage())];
            }

            $order->forceFill([
                'payment_session_id' => $tranId,
                'payment_url' => $session['GatewayPageURL'],
                'payment_expires_at' => now()->addMinutes($minutes),
            ])->save();

            return ['provider' => 'sslcommerz', 'url' => $order->payment_url, 'expires_at' => $order->payment_expires_at?->toIso8601ZuluString()];
        });
    }

    /** The order's payment for the order answers (see StripePayments::summary). */
    public function summary(Order $order, bool $forStaff): array
    {
        $open = $this->canPay($order) && $order->payment_url && $order->payment_expires_at?->isAfter(now()->addMinutes(2));
        $summary = [
            'provider' => $order->payment_provider,
            'paid_at' => $order->paid_at?->toIso8601ZuluString(),
            'url' => $open ? $order->payment_url : null,
            'expires_at' => $open ? $order->payment_expires_at?->toIso8601ZuluString() : null,
            'can_pay' => $this->canPay($order),
        ];
        if ($forStaff) {
            $summary['reference'] = $order->payment_reference;
            $summary['dashboard_url'] = null; // SSLCommerz has no per-transaction page address
        }

        return $summary;
    }

    /** Staff details of an SSLCommerz order (null for other orders): AdminOrderResource.payment.sslcommerz. */
    public function staffDetails(Order $order): ?array
    {
        if ($order->payment_method !== 'sslcommerz' && $order->payment_provider !== 'sslcommerz') {
            return null;
        }
        $details = is_array($order->payment_details) ? $order->payment_details : [];

        return [
            'tran_id' => $details['tran_id'] ?? $order->payment_session_id,
            'val_id' => $details['val_id'] ?? null,
            'bank_tran_id' => $details['bank_tran_id'] ?? null,
            'card_type' => $details['card_type'] ?? null,
            'card_brand' => $details['card_brand'] ?? null,
            'card_issuer' => $details['card_issuer'] ?? null,
            'risk_level' => isset($details['risk_level']) ? (string) $details['risk_level'] : null,
            'risk_title' => $details['risk_title'] ?? null,
            'attempts' => (int) $order->payment_attempts,
            'mode' => $this->gateway->live() ? 'live' : 'sandbox',
            'can_check' => $this->gateway->configured() && $order->payment_attempts > 0 && in_array($order->payment_status, ['unpaid', 'review'], true)
                && $order->status !== 'cancelled',
        ];
    }

    /** "bKash", "Nagad", "Visa card", ... from SSLCommerz's card_type ("BKASH-BKash", "VISA-Dutch Bangla"); null when unknown. */
    public static function methodLabel(Order $order): ?string
    {
        if ($order->payment_provider !== 'sslcommerz' || ! is_array($order->payment_details)) {
            return null;
        }
        $type = trim((string) ($order->payment_details['card_type'] ?? ''));
        if ($type === '') {
            return null;
        }
        $brand = strtoupper(trim((string) ($order->payment_details['card_brand'] ?? '')));
        $code = strtoupper(trim(explode('-', $type, 2)[0]));

        return match (true) {
            str_starts_with($code, 'BKASH') => 'bKash',
            str_starts_with($code, 'NAGAD') => 'Nagad',
            str_starts_with($code, 'ROCKET'), str_starts_with($code, 'DBBL_MOBILE') => 'Rocket',
            str_starts_with($code, 'UPAY') => 'Upay',
            str_starts_with($code, 'VISA') || $brand === 'VISA' => 'Visa card',
            str_starts_with($code, 'MASTER') || $brand === 'MASTERCARD' => 'Mastercard',
            str_starts_with($code, 'AMEX') || $brand === 'AMEX' => 'American Express',
            str_contains($code, 'IBANK') || str_contains($code, 'INTERNET') => 'Internet banking',
            default => trim(explode('-', $type, 2)[0]),
        };
    }

    /** Staff cancelled the order: forget its payment page (SSLCommerz sessions can't be closed; a late payment raises a notification). */
    public function expireOpenSession(Order $order): void
    {
        if ($order->payment_provider === 'sslcommerz' && $order->payment_url) {
            $order->forceFill(['payment_url' => null, 'payment_expires_at' => now()])->save();
        }
    }

    /**
     * Refunds $cents of the payment for a new credit memo on $order. Returns
     * SSLCommerz's refund_ref_id, or null when the order wasn't paid through
     * SSLCommerz. A refusal throws a 422 ("SSLCommerz refused the refund: …").
     * Call inside the memo's transaction, with the order locked.
     */
    public function refund(Order $order, int $cents, int $memoNumber): ?string
    {
        if ($order->payment_provider !== 'sslcommerz' || ! $order->payment_reference) {
            return null;
        }
        if (! $this->gateway->configured()) {
            throw ValidationException::withMessages(['refund' => 'SSLCommerz refused the refund: SSLCommerz payments are not set up (SSLCOMMERZ_STORE_ID is empty).']);
        }

        try {
            $answer = $this->gateway->refund($order->payment_reference, Pricing::format($cents), "Refund for order {$order->number}",
                "{$order->number}-CM{$memoNumber}");
        } catch (SslCommerzException $e) {
            throw ValidationException::withMessages(['refund' => 'SSLCommerz refused the refund: '.$e->getMessage()]);
        }
        $status = strtolower((string) ($answer['status'] ?? ''));
        $reference = is_scalar($answer['refund_ref_id'] ?? null) && (string) $answer['refund_ref_id'] !== '' ? (string) $answer['refund_ref_id'] : null;
        if (! in_array($status, ['success', 'processing'], true)) {
            $reason = is_string($answer['errorReason'] ?? null) && $answer['errorReason'] !== '' ? rtrim($answer['errorReason'], '.') : "its status is {$status}";
            throw ValidationException::withMessages(['refund' => "SSLCommerz refused the refund: {$reason}."]);
        }
        if ($status === 'processing') {
            $order->history()->create([
                'status' => $order->status,
                'payment_status' => $order->payment_status,
                'note' => 'SSLCommerz accepted the refund of '.$order->money(Pricing::format($cents)).' and is still processing it'
                    .($reference ? " (refund {$reference})" : '').'.',
                'customer_notified' => false,
            ]);
        }

        return $reference ?? "{$order->number}-CM{$memoNumber}";
    }

    /**
     * The shopper is back from SSLCommerz (POST /api/v1/payments/sslcommerz/return,
     * forwarded by the sign-in service). $result: success | fail | cancel.
     * Returns [order number or null, outcome].
     */
    public function handleReturn(string $result, string $tranId, ?string $valId): array
    {
        $order = $this->orderForTranId($tranId);
        if (! $order) {
            Log::notice('SSLCommerz return for an unknown order.', ['tran_id' => $tranId, 'result' => $result]);

            return [null, 'unknown_order'];
        }

        if ($result !== 'success') {
            $outcome = $result === 'cancel' ? 'cancelled' : 'failed';
            DB::transaction(function () use ($order, $tranId, $outcome) {
                $order = Order::whereKey($order->id)->lockForUpdate()->first();
                if ($order->payment_status === 'unpaid' && self::attemptOf($order, $tranId) !== null
                    && PaymentEvents::claim('sslcommerz', "return:{$tranId}:{$outcome}", "return {$outcome}")) {
                    $order->history()->create([
                        'status' => $order->status,
                        'payment_status' => $order->payment_status,
                        'note' => 'The shopper came back from SSLCommerz: payment '.($outcome === 'cancelled' ? 'cancelled' : 'failed')
                            ." (attempt {$tranId}). They can try again with Pay now.",
                        'customer_notified' => false,
                    ]);
                }
            });

            return [$order->number, $outcome];
        }

        if (blank($valId)) {
            return [$order->number, 'invalid'];
        }
        // A repeat of a return trip already recorded: no need to ask SSLCommerz again.
        if (in_array($order->payment_status, ['paid', 'review', 'partially_refunded', 'refunded', 'partially_paid'], true)
            && ($order->payment_details['val_id'] ?? null) === $valId) {
            return [$order->number, $order->payment_status === 'review' ? 'review' : 'already_paid'];
        }

        try {
            $payment = $this->gateway->validate((string) $valId);
        } catch (SslCommerzException $e) {
            // Not reachable now: the IPN, Check payment, or the expiry job settles it.
            return [$order->number, $e->unreachable ? 'pending' : 'invalid'];
        }

        return [$order->number, $this->settle($order, $payment, 'return')];
    }

    /**
     * An IPN (POST /api/v1/payments/sslcommerz/ipn). Returns the outcome, or
     * null when it isn't a usable notification (the controller answers 400).
     * Throws SslCommerzException (unreachable) when SSLCommerz can't be
     * asked to validate it: the controller answers 503 and SSLCommerz retries.
     */
    public function handleIpn(array $post): ?string
    {
        $tranId = is_string($post['tran_id'] ?? null) ? trim($post['tran_id']) : '';
        if ($tranId === '' || mb_strlen($tranId) > 64 || $this->gateway->verifySign($post) === false) {
            return null;
        }
        $status = strtoupper(is_string($post['status'] ?? null) ? trim($post['status']) : '');

        if (in_array($status, ['VALID', 'VALIDATED'], true)) {
            $valId = is_string($post['val_id'] ?? null) ? trim($post['val_id']) : '';
            if ($valId === '' || mb_strlen($valId) > 100) {
                return null;
            }
            if (DB::table('payment_events')->where('provider', 'sslcommerz')->where('id', $valId)->exists()) {
                return 'duplicate';
            }
            try {
                $payment = $this->gateway->validate($valId);
            } catch (SslCommerzException $e) {
                if ($e->unreachable) {
                    throw $e;
                }

                return 'invalid';
            }
            // SSLCommerz answers an unknown val_id with status INVALID_TRANSACTION and an empty tran_id: invalid, not an unknown order.
            if (! in_array(strtoupper((string) ($payment['status'] ?? '')), ['VALID', 'VALIDATED'], true)) {
                return 'invalid';
            }
            $order = $this->orderForTranId((string) ($payment['tran_id'] ?? $tranId));
            if (! $order) {
                return 'unknown_order';
            }

            return $this->settle($order, $payment, 'ipn', $valId);
        }

        // FAILED / CANCELLED / EXPIRED / UNATTEMPTED: only a note for staff, once.
        return DB::transaction(function () use ($tranId, $status) {
            if (! PaymentEvents::claim('sslcommerz', "{$tranId}:{$status}", 'ipn '.($status ?: 'UNKNOWN'))) {
                return 'duplicate';
            }
            $order = $this->orderForTranId($tranId, lock: true);
            $outcome = 'ignored';
            if ($order && $order->payment_status === 'unpaid' && self::attemptOf($order, $tranId) !== null) {
                $order->history()->create([
                    'status' => $order->status,
                    'payment_status' => $order->payment_status,
                    'note' => 'SSLCommerz reported attempt '.$tranId.' as '.($status !== '' ? $status : 'not paid').'.',
                    'customer_notified' => false,
                ]);
                $outcome = 'noted';
            }
            PaymentEvents::processed('sslcommerz', "{$tranId}:{$status}");

            return $order ? $outcome : 'unknown_order';
        });
    }

    /**
     * Staff "Check payment": asks SSLCommerz about every attempt and records a
     * completed payment. Returns { found, status, message }. 422 (key "order")
     * when the order can't be checked.
     */
    public function check(Order $order, Admin $admin): array
    {
        $problem = match (true) {
            $order->payment_method !== 'sslcommerz' && $order->payment_provider !== 'sslcommerz' => __('This order isn\'t paid through SSLCommerz.'),
            ! $this->gateway->configured() => 'SSLCommerz payments are not set up (SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASSWORD are empty).',
            $order->payment_attempts < 1 => 'No SSLCommerz payment was started for this order yet.',
            ! in_array($order->payment_status, ['unpaid', 'review'], true) => __('This order has already been paid.'),
            default => null,
        };
        if ($problem) {
            throw ValidationException::withMessages(['order' => $problem]);
        }

        try {
            $payment = $this->findPayment($order);
        } catch (SslCommerzException $e) {
            $result = ['found' => false, 'status' => 'unreachable', 'message' => $e->getMessage()];
            $this->auditCheck($order, $admin, $result);

            return $result;
        }

        if (! $payment) {
            $result = ['found' => false, 'status' => 'not_found', 'message' => 'SSLCommerz has no completed payment for this order ('
                .$order->payment_attempts.' '.($order->payment_attempts === 1 ? 'attempt' : 'attempts').' checked).'];
        } else {
            $outcome = $this->settle($order, $payment, 'check');
            $paid = $order->money($payment['amount'] ?? $payment['currency_amount'] ?? null);
            $result = ['found' => true, 'status' => $outcome, 'message' => match ($outcome) {
                'paid' => "Payment found and recorded: {$paid} (".($payment['card_type'] ?? 'SSLCommerz').'). The order was invoiced.',
                'review' => "Payment found ({$paid}) but SSLCommerz flagged it as risky: it is on hold for review.",
                'already_paid' => 'This payment was already recorded.',
                'mismatch' => 'SSLCommerz has a payment that doesn\'t match the amount due; it was not recorded. Check it in the SSLCommerz panel.',
                'cancelled_order' => 'SSLCommerz has a payment for this cancelled order. Refund it in the SSLCommerz panel.',
                default => 'SSLCommerz has a payment, but it could not be recorded ('.$outcome.').',
            }];
        }
        $this->auditCheck($order, $admin, $result);

        return $result;
    }

    /**
     * Cancels unpaid SSLCommerz orders whose payment window has passed (the
     * scheduled buynest:payments:expire-sslcommerz). SSLCommerz is asked about
     * every attempt first: a payment completed meanwhile is recorded instead.
     *
     * @return array<string, int> outcome => count
     */
    public function expireStale(): array
    {
        // Phase 14: also COD orders whose advance (delivery charge) wasn't paid.
        $ids = Order::whereIn('payment_method', ['sslcommerz', 'cod'])->where('payment_provider', 'sslcommerz')
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
        $order = Order::find($id);
        if (! $order || $order->payment_status !== 'unpaid' || $order->status !== 'pending_payment' || ! $order->payment_expires_at?->isPast()) {
            return 'skipped';
        }

        if ($this->gateway->configured() && $order->payment_attempts > 0) {
            try {
                $payment = $this->findPayment($order);
            } catch (SslCommerzException $e) {
                if ($e->unreachable) {
                    return 'skipped'; // asked again on the next run
                }
                $payment = null; // refused: treated as "nothing paid"
            }
            if ($payment) {
                $outcome = $this->settle($order, $payment, 'expiry');
                if (in_array($outcome, ['paid', 'review', 'already_paid', 'mismatch'], true)) {
                    return $outcome;
                }
            }
        }

        $mail = null;
        $outcome = DB::transaction(function () use ($id, &$mail) {
            $order = Order::whereKey($id)->lockForUpdate()->first();
            // Checked again under the lock: paid, cancelled, or given a new page meanwhile → nothing to do.
            if (! $order || $order->payment_status !== 'unpaid' || $order->status !== 'pending_payment'
                || ($order->payment_method !== 'sslcommerz' && ! $order->hasAdvance()) || ! $order->payment_expires_at?->isPast()) {
                return 'skipped';
            }
            $order->forceFill(['payment_url' => null])->save();
            $this->documents->cancel($order, null, 'Payment not completed: the SSLCommerz payment window expired. Order cancelled; items returned to stock.', true);
            $mail = [$order->email, new PaymentNotCompletedMail($order)];

            return 'cancelled';
        });
        $this->send($mail);

        return $outcome;
    }

    /** A VALID / VALIDATED transaction of one of the order's attempts (newest first), or null. */
    private function findPayment(Order $order): ?array
    {
        for ($attempt = $order->payment_attempts; $attempt >= 1; $attempt--) {
            foreach ($this->gateway->transactions(self::tranId($order, $attempt)) as $transaction) {
                if (in_array(strtoupper((string) ($transaction['status'] ?? '')), ['VALID', 'VALIDATED'], true)) {
                    return $transaction;
                }
            }
        }

        return null;
    }

    /**
     * Records a payment SSLCommerz vouched for (validation API or query API)
     * on $order: locks the order, checks it, then invoices it (or holds it
     * for review). $eventId: the IPN's val_id, claimed in payment_events so a
     * repeated IPN does nothing. Returns the outcome; the invoice email goes
     * out after the commit.
     */
    private function settle(Order $order, array $payment, string $source, ?string $eventId = null): string
    {
        $mail = null;
        $outcome = DB::transaction(function () use ($order, $payment, $source, $eventId, &$mail) {
            if ($eventId !== null && ! PaymentEvents::claim('sslcommerz', $eventId, "{$source} ".($payment['status'] ?? ''))) {
                return 'duplicate';
            }
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            $outcome = $this->record($order, $payment, $mail);
            if ($eventId !== null) {
                PaymentEvents::processed('sslcommerz', $eventId);
            }

            return $outcome;
        });
        $this->send($mail);

        return $outcome;
    }

    /**
     * Checks a payment against the (locked) order: valid, one of its
     * attempts, the order's currency, the amount due to the cent. Then
     * invoices it, or holds it for review when SSLCommerz says risk level 1.
     *
     * @param  array{0: string, 1: Mailable}|null  $mail
     */
    private function record(Order $order, array $payment, ?array &$mail): string
    {
        $status = strtoupper((string) ($payment['status'] ?? ''));
        if (! in_array($status, ['VALID', 'VALIDATED'], true)) {
            return 'invalid';
        }
        $tranId = (string) ($payment['tran_id'] ?? '');
        $valId = is_scalar($payment['val_id'] ?? null) ? (string) $payment['val_id'] : null;
        $bankTranId = is_scalar($payment['bank_tran_id'] ?? null) ? (string) $payment['bank_tran_id'] : null;
        $currency = strtoupper((string) ($payment['currency_type'] ?? $payment['currency'] ?? ''));
        $amountText = $payment['amount'] ?? $payment['currency_amount'] ?? null;
        $amount = is_numeric($amountText) ? Pricing::toCents((string) $amountText) : -1;
        $paidText = $currency !== '' ? Currency::formatCents(max(0, $amount), $currency).' '.$currency : 'a payment';
        $label = $payment['card_type'] ?? 'SSLCommerz';

        if (self::attemptOf($order, $tranId) === null) {
            Log::warning('SSLCommerz payment for another transaction.', ['order' => $order->number, 'tran_id' => $tranId, 'val_id' => $valId]);

            return 'mismatch';
        }
        if ($order->payment_status !== 'unpaid' || $order->invoices()->exists()) {
            if ($valId !== null && ($order->payment_details['val_id'] ?? null) === $valId) {
                return $order->payment_status === 'review' ? 'review' : 'already_paid';
            }
            $this->problem($order, "Order {$order->number} was paid again through SSLCommerz",
                "SSLCommerz took a second payment ({$paidText}, {$label}, bank transaction {$bankTranId}, tran_id {$tranId}) for an order that was already paid. "
                .'Refund it in the SSLCommerz panel.');

            return 'already_paid';
        }
        if ($order->status === 'cancelled') {
            $this->problem($order, "Payment received for cancelled order {$order->number}",
                "SSLCommerz took {$paidText} ({$label}, bank transaction {$bankTranId}) after the order was cancelled. Refund it in the SSLCommerz panel.");

            return 'cancelled_order';
        }
        if ($amount !== $order->onlineDueCents() || $currency !== $order->currencyCode()) {
            Log::warning('SSLCommerz payment does not match the order.', [
                'order' => $order->number, 'tran_id' => $tranId, 'amount' => $amount, 'currency' => $currency,
                'expected_amount' => $order->onlineDueCents(), 'expected_currency' => $order->currencyCode(),
            ]);
            $this->problem($order, "Payment amount mismatch on order {$order->number}",
                "SSLCommerz reported {$paidText} (tran_id {$tranId}) but the amount due is ".$order->money(Pricing::format($order->onlineDueCents())).' '.$order->currencyCode()
                .'. The order was left unpaid: check the payment in the SSLCommerz panel.');
            $order->history()->create([
                'status' => $order->status,
                'payment_status' => $order->payment_status,
                'note' => "SSLCommerz reported a payment of {$paidText} that doesn't match the amount due; the order was left unpaid.",
                'customer_notified' => false,
            ]);

            return 'mismatch';
        }

        $details = array_filter([
            'tran_id' => $tranId,
            'val_id' => $valId,
            'bank_tran_id' => $bankTranId,
            'card_type' => self::text($payment['card_type'] ?? null),
            'card_brand' => self::text($payment['card_brand'] ?? null),
            'card_issuer' => self::text($payment['card_issuer'] ?? null),
            'risk_level' => isset($payment['risk_level']) && is_scalar($payment['risk_level']) ? (string) $payment['risk_level'] : null,
            'risk_title' => self::text($payment['risk_title'] ?? null),
            'validated_at' => now()->toIso8601ZuluString(),
        ], fn ($value) => $value !== null);
        $order->forceFill([
            'payment_provider' => 'sslcommerz',
            'payment_reference' => $bankTranId,
            'payment_details' => $details,
            'payment_url' => null,
        ])->save();
        $method = self::methodLabel($order) ?? 'SSLCommerz';

        if (($details['risk_level'] ?? '0') === '1') {
            $order->forceFill(['payment_status' => 'review'])->save();
            $order->history()->create([
                'status' => $order->status,
                'payment_status' => 'review',
                'note' => "SSLCommerz took {$paidText} with {$method} (bank transaction {$bankTranId}) but flagged it as risky"
                    .(isset($details['risk_title']) ? " ({$details['risk_title']})" : '').'. The payment is on hold: check it, then create the invoice, '
                    .'or cancel the order and refund it in the SSLCommerz panel.',
                'customer_notified' => false,
            ]);
            $this->problem($order, "Payment on hold for order {$order->number}",
                "SSLCommerz flagged the payment ({$paidText}, {$method}) as risky. Check it, then create the invoice or cancel and refund.");

            return 'review';
        }

        $order->forceFill(['paid_at' => now()])->save();
        $invoice = $order->hasAdvance()
            // Phase 14: the advance delivery charge of a cash on delivery order; the rest is collected on delivery.
            ? $this->documents->recordAdvance($order, $amount, ($method === 'SSLCommerz' ? 'Advance delivery charge paid through SSLCommerz.'
                : "Advance delivery charge paid with {$method} through SSLCommerz.").' The rest is collected on delivery.')
            : $this->documents->invoice($order, null, $method === 'SSLCommerz' ? 'Paid through SSLCommerz.' : "Paid with {$method} through SSLCommerz.", true);
        $invoice->load(['order']);
        $mail = [$order->email, new InvoiceMail($invoice)];
        // Phase 20: the "order received" text goes once the payment is in (sent after the commit).
        app(Sms::class)->paid($order);

        return 'paid';
    }

    /** "<order number>-<attempt>". */
    public static function tranId(Order $order, int $attempt): string
    {
        return "{$order->number}-{$attempt}";
    }

    /** The attempt number of $tranId when it is one of $order's attempts, else null. */
    public static function attemptOf(Order $order, string $tranId): ?int
    {
        $prefix = $order->number.'-';
        if (! str_starts_with(strtoupper($tranId), strtoupper($prefix))) {
            return null;
        }
        $attempt = substr($tranId, strlen($prefix));

        return ctype_digit($attempt) && (int) $attempt >= 1 && (int) $attempt <= $order->payment_attempts ? (int) $attempt : null;
    }

    /** The order number in a tran_id ("BN-100123-2" → "BN-100123"), or null. */
    public static function orderNumberOf(string $tranId): ?string
    {
        return preg_match('/^(.+)-\d+$/', trim($tranId), $m) ? strtoupper($m[1]) : null;
    }

    private function orderForTranId(string $tranId, bool $lock = false): ?Order
    {
        $number = self::orderNumberOf($tranId);
        if ($number === null) {
            return null;
        }
        $query = Order::where('number', $number);

        return ($lock ? $query->lockForUpdate() : $query)->first();
    }

    private function auditCheck(Order $order, Admin $admin, array $result): void
    {
        $this->audit->record('order.payment_checked', "SSLCommerz payment checked for order {$order->number}: {$result['status']}.", 'order', $order->id,
            ['before' => [], 'after' => ['found' => $result['found'], 'status' => $result['status']]], $admin);
    }

    private function problem(Order $order, string $title, string $body): void
    {
        $this->notifications->notify('payment_problem', "order:{$order->id}", $title, $body, "/orders/{$order->number}");
    }

    private static function clip(?string $value, int $length): string
    {
        return mb_substr(trim((string) $value), 0, $length);
    }

    private static function text(mixed $value): ?string
    {
        return is_scalar($value) && trim((string) $value) !== '' ? mb_substr(trim((string) $value), 0, 100) : null;
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
            $this->audit->record('order.payment_link_created', "SSLCommerz payment link created for order {$order->number}.", 'order', $order->id,
                ['before' => [], 'after' => ['expires_at' => $payment['expires_at']]], $admin);
        }
    }
}
