<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\Order;
use App\Services\Payments\PayPalPayments;
use App\Services\Payments\SslCommerzPayments;
use App\Services\Payments\StripePayments;
use App\Services\Pricing;
use App\Support\EmailBlocks;
use Illuminate\Mail\Mailable;

/** "Thanks for your order": items, totals, address, and what happens next (template order_confirmation). */
class OrderPlacedMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public Order $order) {}

    /** Phase 12: the order's currency. */
    protected function templateCurrency(): ?string
    {
        return $this->order->currencyCode();
    }

    protected function templateKey(): string
    {
        return 'order_confirmation';
    }

    protected function templateValues(): array
    {
        $order = $this->order;
        $totals = [['Subtotal', $this->money($order->subtotal)]];
        if ((float) $order->discount_total > 0) {
            $totals[] = ['Discount'.($order->coupon_code ? " ({$order->coupon_code})" : ''), '-'.$this->money($order->discount_total)];
        }
        $totals[] = ["Shipping ({$order->shipping_label})", $this->money($order->shipping_total)];
        $totals[] = ['Tax', $this->money($order->tax_total)];
        $totals[] = ['Total', $this->money($order->grand_total), true];
        // Phase 11: the part reward points paid (before the gift card).
        $points = (int) $order->reward_points_spent;
        if ($points > 0) {
            $totals[] = ['Reward points ('.number_format($points).' pts)', '-'.$this->money($order->reward_points_amount)];
        }
        // Phase 10 (part B): the part a gift card paid, and what is left.
        if ((float) $order->gift_card_amount > 0) {
            $totals[] = ['Paid by gift card', '-'.$this->money($order->gift_card_amount)];
        }
        if ((float) $order->gift_card_amount > 0 || $points > 0) {
            $totals[] = ['Amount due', $this->money(Pricing::format($order->dueCents())), true];
        }

        return [
            'customer_first_name' => $order->shipping_address['first_name'] ?? 'there',
            'order_number' => $order->number,
            'order_total' => $order->grand_total,
            'payment_method' => config("buynest.store.payment_methods.{$order->payment_method}")
                ?? config("buynest.store.admin_payment_methods.{$order->payment_method}", match ($order->payment_method) {
                    'gift_card' => 'Gift card', 'reward_points' => 'Reward points', default => $order->payment_method, // phase 11: reward points
                }),
            'shipping_method' => $order->shipping_label,
            'delivery_estimate' => $order->shipping_eta,
            'next_steps' => match (true) {
                $order->payment_method === 'cod' => 'We are preparing your order now. Please pay the courier in cash when it arrives.',
                // Phase 10 (part B): paid in full with a gift card; PayPal orders are approved on PayPal's site.
                $order->payment_method === 'gift_card' => 'Your gift card paid for the whole order, so we are preparing it now.',
                $order->payment_method === 'reward_points' => 'Your reward points paid for the whole order, so we are preparing it now.', // phase 11
                app(PayPalPayments::class)->usesPayPal($order) => 'Your items are reserved. Complete the payment on PayPal '
                    .'(you can also use “Pay now” on your order page); we start preparing your order as soon as it is paid.',
                // Phase 12: bKash, Nagad, or card on SSLCommerz's page.
                app(SslCommerzPayments::class)->usesSslCommerz($order) => 'Your items are reserved. Complete the payment on SSLCommerz’s secure page '
                    .'(bKash, Nagad, or card; you can also use “Pay now” on your order page); we start preparing your order as soon as it is paid.',
                // Phase 8: card orders are paid on Stripe's secure page.
                app(StripePayments::class)->usesStripe($order) => 'Your items are reserved. Complete the card payment on our secure payment page '
                    .'(you can also use “Pay now” on your order page); we start preparing your order as soon as it is paid.',
                default => 'Your items are reserved. Online payment is not connected yet: we will contact you with a secure payment link, and we start preparing your order as soon as it is paid.',
            },
            'items_table' => EmailBlocks::itemsTable(
                $order->items->map(fn ($item) => ["{$item->displayName()} × {$item->quantity}", $this->money($item->line_total)])->all(),
                $totals,
            ),
            'address' => EmailBlocks::address($order->shipping_address),
            // Phase 11: "You used 500 reward points ($5.00) on this order." (empty without points).
            'reward_points_spent' => $points > 0
                ? EmailBlocks::paragraph('You used '.number_format($points).' reward points ('.$this->money($order->reward_points_amount).') on this order.')
                : '',
        ];
    }
}
