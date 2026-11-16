<?php

namespace App\Services;

use App\Models\Admin;
use App\Models\Coupon;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Shipment;
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
    public function __construct(private Audit $audit, private Inventory $inventory) {}

    /**
     * Cancels an order (PATCH status "cancelled", and the bulk action): puts
     * every item back in stock (its variant; also products deleted since),
     * gives the coupon use back, and writes the history and audit entries.
     * Refused once the order has an invoice (refund it instead), and for
     * statuses that can't move to cancelled. The caller sends the email.
     */
    public function cancel(Order $order, Admin $admin, ?string $note, bool $notify, string $errorKey = 'order'): void
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
        $this->inventory->restock($order->items->map(fn ($item) => [
            'product_id' => $item->product_id, 'variant_id' => $item->variant_id, 'quantity' => $item->quantity,
        ])->all(), withTrashed: true);
        Coupon::releaseFor($order);
        $order->forceFill(['status' => 'cancelled'])->save();

        $order->history()->create([
            'status' => 'cancelled',
            'payment_status' => $order->payment_status,
            'note' => $note ?? 'Order cancelled; items returned to stock.',
            'admin_id' => $admin->id,
            'customer_notified' => $notify,
        ]);
        $this->audit->record('order.status_changed', "Order {$order->number}: {$from} → cancelled.", 'order', $order->id,
            Audit::diff(['status' => $from, 'note' => null], ['status' => 'cancelled', 'note' => $note]), $admin);
    }

    /** Records the payment of the full grand total: paid, and pending_payment → processing. */
    public function invoice(Order $order, Admin $admin, ?string $note, bool $notify, string $errorKey = 'order'): Invoice
    {
        if ($order->status === 'cancelled') {
            throw ValidationException::withMessages([$errorKey => 'A cancelled order can\'t be invoiced.']);
        }
        // Also refuse when the payment is already recorded (e.g. a paid order without an invoice): never invoice twice.
        if ($order->invoices()->exists() || $order->payment_status !== 'unpaid') {
            throw ValidationException::withMessages([$errorKey => 'This order has already been invoiced.']);
        }

        $invoice = $order->invoices()->create([
            'amount' => $order->grand_total,
            'admin_id' => $admin->id,
            'note' => $note,
            'customer_notified' => $notify,
        ]);
        $invoice->forceFill(['number' => Invoice::numberFor($invoice->id)])->save();

        $order->forceFill([
            'payment_status' => 'paid',
            // Paid card/PayPal orders are ready to be prepared.
            'status' => $order->status === 'pending_payment' ? 'processing' : $order->status,
        ])->save();

        $order->history()->create([
            'status' => $order->status,
            'payment_status' => 'paid',
            'note' => "Invoice {$invoice->number} created; payment of \${$invoice->amount} recorded.",
            'admin_id' => $admin->id,
            'customer_notified' => $notify,
        ]);
        $this->audit->record('invoice.created', "Invoice {$invoice->number} created for order {$order->number} (\${$invoice->amount}).",
            'invoice', $invoice->id, ['before' => ['payment_status' => 'unpaid'], 'after' => ['payment_status' => 'paid', 'amount' => $invoice->amount]], $admin);

        return $invoice;
    }

    /**
     * Ships every item (one shipment per order in phase 3): processing → shipped.
     * Cash on delivery (and cash, phase 6) may ship unpaid; card/PayPal/bank transfer must be invoiced first.
     * $historyNote replaces the generated history note (the PATCH shortcut
     * keeps phase 2's behaviour: the staff note IS the history note).
     */
    public function ship(Order $order, Admin $admin, string $carrier, ?string $trackingNumber, ?string $note, bool $notify,
        ?string $historyNote = null, string $errorKey = 'order'): Shipment
    {
        $notPaidYet = 'Invoice this order before shipping it: it hasn\'t been paid yet.';
        $problem = match (true) {
            $order->shipments()->exists(), in_array($order->status, ['shipped', 'delivered'], true) => 'This order has already been shipped.',
            $order->status === 'pending_payment' => $notPaidYet,
            $order->status !== 'processing' => 'A '.str_replace('_', ' ', $order->status).' order can\'t be shipped.',
            ! in_array($order->payment_method, Order::PAY_LATER_METHODS, true) && ! $order->invoices()->exists() => $notPaidYet,
            default => null,
        };
        if ($problem) {
            throw ValidationException::withMessages([$errorKey => $problem]);
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
