<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\Order;
use App\Services\Payments\PayPalPayments;
use App\Services\Payments\StripePayments;
use App\Services\Pricing;
use App\Support\EmailBlocks;
use Illuminate\Mail\Mailable;

/** "Thanks for your order": items, totals, address, and what happens next (template order_confirmation). */
class OrderPlacedMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public Order $order) {}

    protected function templateKey(): string
    {
        return 'order_confirmation';
    }

    protected function templateValues(): array
    {
        $order = $this->order;
        $totals = [['Subtotal', self::money($order->subtotal)]];
        if ((float) $order->discount_total > 0) {
            $totals[] = ['Discount'.($order->coupon_code ? " ({$order->coupon_code})" : ''), '-'.self::money($order->discount_total)];
        }
        $totals[] = ["Shipping ({$order->shipping_label})", self::money($order->shipping_total)];
        $totals[] = ['Tax', self::money($order->tax_total)];
        $totals[] = ['Total', self::money($order->grand_total), true];
        // Phase 10 (part B): the part a gift card paid, and what is left.
        if ((float) $order->gift_card_amount > 0) {
            $totals[] = ['Paid by gift card', '-'.self::money($order->gift_card_amount)];
            $totals[] = ['Amount due', '$'.Pricing::format($order->dueCents()), true];
        }

        return [
            'customer_first_name' => $order->shipping_address['first_name'] ?? 'there',
            'order_number' => $order->number,
            'order_total' => $order->grand_total,
            'payment_method' => config("buynest.store.payment_methods.{$order->payment_method}")
                ?? config("buynest.store.admin_payment_methods.{$order->payment_method}", $order->payment_method === 'gift_card' ? 'Gift card' : $order->payment_method),
            'shipping_method' => $order->shipping_label,
            'delivery_estimate' => $order->shipping_eta,
            'next_steps' => match (true) {
                $order->payment_method === 'cod' => 'We are preparing your order now. Please pay the courier in cash when it arrives.',
                // Phase 10 (part B): paid in full with a gift card; PayPal orders are approved on PayPal's site.
                $order->payment_method === 'gift_card' => 'Your gift card paid for the whole order, so we are preparing it now.',
                app(PayPalPayments::class)->usesPayPal($order) => 'Your items are reserved. Complete the payment on PayPal '
                    .'(you can also use “Pay now” on your order page); we start preparing your order as soon as it is paid.',
                // Phase 8: card orders are paid on Stripe's secure page.
                app(StripePayments::class)->usesStripe($order) => 'Your items are reserved. Complete the card payment on our secure payment page '
                    .'(you can also use “Pay now” on your order page); we start preparing your order as soon as it is paid.',
                default => 'Your items are reserved. Online payment is not connected yet: we will contact you with a secure payment link, and we start preparing your order as soon as it is paid.',
            },
            'items_table' => EmailBlocks::itemsTable(
                $order->items->map(fn ($item) => ["{$item->displayName()} × {$item->quantity}", self::money($item->line_total)])->all(),
                $totals,
            ),
            'address' => EmailBlocks::address($order->shipping_address),
        ];
    }
}
