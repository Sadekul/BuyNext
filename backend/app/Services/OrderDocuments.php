<?php

namespace App\Services;

use App\Models\Admin;
use App\Models\Coupon;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Shipment;
use App\Services\Payments\OnlinePayments;
use Illuminate\Validation\ValidationException;

/**
 * Invoices and shipments: the rules for creating them and what they change
 * on the order. Call these inside a DB transaction with the order row locked
 * (lockForUpdate), so two staff members clicking at once can't invoice or
 * ship the same order twice. Emails are sent by the caller after the commit.
 *
 * $errorKey: the field 422 errors are reported on ("order" for the document
 * endpoints; the PATCH shortcuts use "payment_status" / "status").
 */
class OrderDocuments
{
    /** Phase 14: shipping a COD order that hasn't been confirmed by phone. */
    public const UNCONFIRMED = 'This cash on delivery order hasn\'t been confirmed by phone yet. Confirm it first, or ship it anyway with a reason.';

    public function __construct(private Audit $audit, private Inventory $inventory) {}

    /**
     * Cancels an order (PATCH status "cancelled", and the bulk action): puts
     * every item back in stock (its variant; also products deleted since),
     * gives the coupon use back, and writes the history and audit entries.
     * Refused once the order has an invoice (refund it instead), and for
     * statuses that can't move to cancelled. The caller sends the email.
     * Phase 8: $admin is null when Stripe's payment page expired (webhook);
     * an open Stripe payment page is closed, so it can't be paid any more.
     * Phase 20: $actor names who cancelled when no staff member did ("Customer (SMS link)").
     */
    public function cancel(Order $order, ?Admin $admin, ?string $note, bool $notify, string $errorKey = 'order', ?string $actor = null): void
    {
        $from = $order->status;
        if (! $order->canMoveTo('cancelled')) {
            $label = str_replace('_', ' ', $from);
            throw ValidationException::withMessages([$errorKey => $from === 'cancelled' ? 'This order is already cancelled.' : "A {$label} order can't be cancelled."]);
        }
        if ($order->invoices()->exists()) {
            throw ValidationException::withMessages([$errorKey => 'This order has been invoiced (paid), so it can\'t be cancelled. Create a refund (credit memo) instead.']);
        }

        $order->load('items');
        // Phase 10 (part B): gift card lines took no stock, so they give none back.
        $this->inventory->restock($order->items->reject(fn ($item) => $item->isGiftCard())->map(fn ($item) => [
            'product_id' => $item->product_id, 'variant_id' => $item->variant_id, 'quantity' => $item->quantity,
        ])->all(), withTrashed: true);
        Coupon::releaseFor($order);
        // Phase 10 (part B): a redeemed gift card gets its amount back.
        app(GiftCards::class)->release($order);
        // Phase 11: spent reward points come back.
        app(RewardPoints::class)->release($order);
        $order->forceFill(['status' => 'cancelled'])->save();
        // Resolved here, not injected: the payment services use this class too. Phase 10 (part B): Stripe or PayPal.
        app(OnlinePayments::class)->expireOpenSession($order);

        $order->history()->create([
            'status' => 'cancelled',
            'payment_status' => $order->payment_status,
            'note' => $note ?? 'Order cancelled; items returned to stock.',
            'admin_id' => $admin?->id,
            'actor' => $admin ? null : $actor,
            'customer_notified' => $notify,
        ]);
        $this->audit->record('order.status_changed', "Order {$order->number}: {$from} → cancelled.", 'order', $order->id,
            Audit::diff(['status' => $from, 'note' => null], ['status' => 'cancelled', 'note' => $note]), $admin);
    }

    /**
     * Records the payment of the full grand total: paid, and pending_payment → processing.
     * Phase 8: $admin is null when Stripe reported the payment (webhook).
     * Phase 14: an order already partly paid (a COD advance, or a short cash
     * collection: partially_paid) is invoiced for the rest.
     */
    public function invoice(Order $order, ?Admin $admin, ?string $note, bool $notify, string $errorKey = 'order'): Invoice
    {
        if ($order->status === 'cancelled') {
            throw ValidationException::withMessages([$errorKey => 'A cancelled order can\'t be invoiced.']);
        }
        // Also refuse when the payment is already recorded (e.g. a paid order without an invoice): never invoice twice.
        // Phase 12: "review" (an SSLCommerz payment held for a risk check) is approved by invoicing it.
        $order->unsetRelation('invoices');
        $rest = Pricing::toCents($order->grand_total) - $order->paidCents();
        $partlyPaid = $order->payment_status === 'partially_paid';
        if ((! $partlyPaid && $order->invoices()->exists()) || ! in_array($order->payment_status, ['unpaid', 'review', 'partially_paid'], true) || $rest <= 0) {
            throw ValidationException::withMessages([$errorKey => 'This order has already been invoiced.']);
        }

        return $this->createInvoice($order, $admin, $rest, $note, $notify, null);
    }

    /**
     * Phase 14: the advance of a COD order (delivery charge + fee) was paid
     * online: an invoice for it, pending_payment → processing, and
     * partially_paid (paid when nothing is left to collect).
     * Phase 21: the invoice's kind is "advance".
     */
    public function recordAdvance(Order $order, int $cents, string $note): Invoice
    {
        $invoice = $this->createInvoice($order, null, $cents, $note, true, null, kind: ['kind' => 'advance']);
        $order->forceFill(['advance_paid' => Pricing::format($cents)])->save();

        return $invoice;
    }

    /**
     * Phase 14: staff collected $cents in cash for a COD order (on delivery).
     * The whole amount due → an invoice for the rest of the order (paid).
     * Less → an invoice for what was collected (when > 0), partially_paid, and
     * the rest stays in cod_due (a $note is required, and staff are notified).
     *
     * Phase 18: $admin is null when a courier reported the cash (a delivered
     * COD parcel); $actor ("Steadfast") then names who did it in the history,
     * and the audit entry has no admin (actor "system").
     *
     * Phase 21: the invoice's kind is "cod_collection", and $via says who
     * has the cash: the courier's code ("steadfast") when the order went with
     * a courier (it reported the cash, or staff recorded it), else "staff".
     */
    public function collect(Order $order, ?Admin $admin, int $cents, ?string $note, string $errorKey = 'collected_amount', ?string $actor = null,
        ?string $via = null): ?Invoice
    {
        $due = $order->codDueCents();
        $problem = match (true) {
            ! $order->isCod() => 'Only cash on delivery orders collect cash.',
            in_array($order->status, ['cancelled', 'closed', 'pending_payment'], true) => 'A '.str_replace('_', ' ', $order->status).' order can\'t collect cash.',
            $due <= 0 => 'Nothing is left to collect on this order.',
            $cents > $due => 'That is more than the '.$order->money(Pricing::format($due)).' to collect.',
            default => null,
        };
        if ($problem) {
            throw ValidationException::withMessages([$errorKey => $problem]);
        }
        if ($cents < $due && blank($note)) {
            throw ValidationException::withMessages(['collection_note' => 'Say why less than '.$order->money(Pricing::format($due)).' was collected.']);
        }

        $advance = Pricing::toCents($order->advance_paid ?? 0);
        $collected = Pricing::toCents($order->cod_collected ?? 0) + $cents;
        $lines = 'Cash collected on delivery: '.$order->money(Pricing::format($cents)).'.'
            .($advance > 0 ? ' Advance paid online: '.$order->money(Pricing::format($advance)).'.' : '');
        $invoice = null;
        $kind = ['kind' => 'cod_collection', 'collected_via' => $via ?? ($admin ? 'staff' : null)];
        if ($cents === $due) {
            $invoice = $this->createInvoice($order, $admin, Pricing::toCents($order->grand_total) - $order->paidCents(), trim($lines.' '.($note ?? '')), false, null, $actor,
                $kind);
        } elseif ($cents > 0) {
            $invoice = $this->createInvoice($order, $admin, $cents, trim($lines.' '.$note), false, 'partially_paid', $actor, $kind);
        }
        $order->forceFill(['cod_due' => Pricing::format($due - $cents), 'cod_collected' => Pricing::format($collected)])->save();

        if ($cents < $due) {
            $short = $order->money(Pricing::format($due - $cents));
            $order->history()->create([
                'status' => $order->status,
                'payment_status' => $order->payment_status,
                'note' => "Short collection: {$order->money(Pricing::format($cents))} collected, {$short} still to collect. {$note}",
                'admin_id' => $admin?->id,
                'actor' => $admin ? null : $actor,
                'customer_notified' => false,
            ]);
            app(AdminNotifications::class)->notify('cod_short_collection', "order:{$order->id}", "Short cash collection on order {$order->number}",
                ($admin?->name ?? $actor ?? 'The courier')." collected {$order->money(Pricing::format($cents))}; {$short} is still to collect. Note: {$note}",
                "/orders/{$order->number}");
        }
        $this->audit->record('order.cash_collected', "Cash collected for order {$order->number}: {$order->money(Pricing::format($cents))}"
            .($cents < $due ? ' (short)' : '').($admin ? '' : " (reported by {$actor})").'.', 'order', $order->id,
            ['before' => ['cod_due' => Pricing::format($due)], 'after' => ['cod_due' => Pricing::format($due - $cents), 'collected' => Pricing::format($cents),
                'payment_status' => $order->payment_status, ...($admin ? [] : ['actor' => 'system'])]], $admin, anonymous: $admin === null);

        return $invoice;
    }

    /**
     * An invoice of $cents: the order becomes paid when the invoices reach the
     * grand total (or $paymentStatus), and pending_payment → processing.
     * Phase 21: $kind = ['kind' => ..., 'collected_via' => ...] for advances and cash collections.
     */
    private function createInvoice(Order $order, ?Admin $admin, int $cents, ?string $note, bool $notify, ?string $paymentStatus, ?string $actor = null,
        array $kind = []): Invoice
    {
        $paymentBefore = $order->payment_status;
        $invoice = $order->invoices()->create([
            ...$kind,
            'amount' => Pricing::format($cents),
            'admin_id' => $admin?->id,
            'note' => $note,
            'customer_notified' => $notify,
        ]);
        $invoice->forceFill(['number' => Invoice::numberFor($invoice->id)])->save();
        $order->unsetRelation('invoices');
        $paid = $paymentStatus ?? ($order->paidCents() >= Pricing::toCents($order->grand_total) ? 'paid' : 'partially_paid');

        $order->forceFill([
            'payment_status' => $paid,
            // Paid card/PayPal orders are ready to be prepared.
            'status' => $order->status === 'pending_payment' ? 'processing' : $order->status,
            ...($paid === 'paid' && $order->isCod() ? ['cod_due' => '0.00'] : []),
        ])->save();

        $order->history()->create([
            'status' => $order->status,
            'payment_status' => $paid,
            'note' => "Invoice {$invoice->number} created; payment of {$order->money($invoice->amount)} recorded."
                // Phase 10 (part B): the payment's own note ("Paid by card through Stripe.", "Paid through PayPal.", "Paid with gift card ••••ABCD.").
                .($admin ? '' : ' '.($note ?? 'Paid online.')),
            'admin_id' => $admin?->id,
            'actor' => $admin ? null : $actor, // phase 18: "Steadfast" when a courier reported the cash
            'customer_notified' => $notify,
        ]);
        $this->audit->record('invoice.created', "Invoice {$invoice->number} created for order {$order->number} ({$order->money($invoice->amount)}).",
            'invoice', $invoice->id, ['before' => ['payment_status' => $paymentBefore], 'after' => ['payment_status' => $paid, 'amount' => $invoice->amount]], $admin);

        if ($paid === 'paid') {
            // Phase 10 (part B): gift cards bought with the order are made (and emailed after the commit) once it is paid.
            app(GiftCards::class)->issueFor($order);
            // Phase 11: a signed-in customer's paid order earns reward points (once).
            app(RewardPoints::class)->earnFor($order);
        }

        return $invoice;
    }

    /**
     * Why $order can't ship now (null: it can). ship() refuses with it; phase
     * 18's courier booking asks first, before calling the courier, so a
     * parcel is never booked for an order that then can't ship.
     */
    public function shipProblem(Order $order, ?string $confirmationOverride = null): ?string
    {
        $notPaidYet = 'Invoice this order before shipping it: it hasn\'t been paid yet.';

        return match (true) {
            $order->shipments()->exists(), in_array($order->status, ['shipped', 'delivered'], true) => 'This order has already been shipped.',
            $order->status === 'pending_payment' => $notPaidYet,
            $order->status !== 'processing' => 'A '.str_replace('_', ' ', $order->status).' order can\'t be shipped.',
            ! in_array($order->payment_method, Order::PAY_LATER_METHODS, true) && ! $order->invoices()->exists() => $notPaidYet,
            // Phase 14: a COD order waiting for its phone confirmation ships only with a reason (audited).
            $order->awaitsConfirmation() && blank($confirmationOverride) => self::UNCONFIRMED,
            default => null,
        };
    }

    /**
     * Ships every item (one shipment per order in phase 3): processing → shipped.
     * Cash on delivery (and cash, phase 6) may ship unpaid; card/PayPal/bank transfer must be invoiced first.
     * $historyNote replaces the generated history note (the PATCH shortcut
     * keeps phase 2's behaviour: the staff note IS the history note).
     */
    public function ship(Order $order, Admin $admin, string $carrier, ?string $trackingNumber, ?string $note, bool $notify,
        ?string $historyNote = null, string $errorKey = 'order', ?string $confirmationOverride = null): Shipment
    {
        if ($problem = $this->shipProblem($order, $confirmationOverride)) {
            throw ValidationException::withMessages([$errorKey => $problem]);
        }
        if ($order->awaitsConfirmation()) {
            $reason = trim((string) $confirmationOverride);
            $order->confirmationLogs()->create(['admin_id' => $admin->id, 'outcome' => 'override', 'note' => $reason]);
            $this->audit->record('order.confirmation_overridden', "Order {$order->number} shipped without a phone confirmation: {$reason}", 'order', $order->id,
                ['before' => ['confirmation_status' => $order->confirmation_status], 'after' => ['override_reason' => $reason]], $admin);
        }

        $shipment = $order->shipments()->create([
            'carrier' => $carrier,
            'tracking_number' => $trackingNumber,
            'admin_id' => $admin->id,
            'note' => $note,
            'customer_notified' => $notify,
        ]);
        $shipment->forceFill(['number' => Shipment::numberFor($shipment->id)])->save();

        $order->forceFill(['status' => 'shipped'])->save();

        $order->history()->create([
            'status' => 'shipped',
            'payment_status' => $order->payment_status,
            'note' => $historyNote ?? "Shipment {$shipment->number} created: {$shipment->carrierLabel()}"
                .($trackingNumber ? ", tracking number {$trackingNumber}." : ', no tracking number.'),
            'admin_id' => $admin->id,
            'customer_notified' => $notify,
        ]);
        $this->audit->record('shipment.created', "Shipment {$shipment->number} created for order {$order->number} ({$shipment->carrierLabel()}"
            .($trackingNumber ? ", {$trackingNumber}" : '').').', 'shipment', $shipment->id,
            ['before' => [], 'after' => ['order' => $order->number, 'carrier' => $carrier, 'tracking_number' => $trackingNumber]], $admin);

        return $shipment;
    }
}
