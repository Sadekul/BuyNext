<?php

namespace App\Services\Payments;

use App\Models\Admin;
use App\Models\Order;

/**
 * Phase 10 (part B): one door to the online payment providers. Card orders
 * go to Stripe (phase 8), PayPal orders to PayPal; everything that used to
 * ask StripePayments directly (order answers, Pay now, staff payment links,
 * staff cancel, refunds) asks this class, so each provider keeps its own rules.
 */
class OnlinePayments
{
    public function __construct(private StripePayments $stripe, private PayPalPayments $paypal) {}

    /** The provider service for $order: PayPal for PayPal orders (or ones PayPal took), else Stripe. */
    public function for(Order $order): StripePayments|PayPalPayments
    {
        return $order->payment_method === 'paypal' || $order->payment_provider === 'paypal' ? $this->paypal : $this->stripe;
    }

    /** Is the order paid online (provider on) and is there something left to pay? */
    public function uses(Order $order): bool
    {
        $uses = $order->payment_method === 'paypal' ? $this->paypal->usesPayPal($order) : $this->stripe->usesStripe($order);

        return $uses && $order->dueCents() > 0;
    }

    public function startCheckout(Order $order, bool $forAdmin = false): array
    {
        return $this->for($order)->startCheckout($order, $forAdmin);
    }

    public function payProblem(Order $order): ?string
    {
        return $this->for($order)->payProblem($order);
    }

    public function summary(Order $order, bool $forStaff): array
    {
        return $this->for($order)->summary($order, $forStaff);
    }

    public function expireOpenSession(Order $order): void
    {
        $this->for($order)->expireOpenSession($order);
    }

    /** The provider's refund id, or null when the order wasn't paid online (see StripePayments::refund). */
    public function refund(Order $order, int $cents, int $memoNumber): ?string
    {
        return match ($order->payment_provider) {
            'paypal' => $this->paypal->refund($order, $cents, $memoNumber),
            'stripe' => $this->stripe->refund($order, $cents, $memoNumber),
            default => null,
        };
    }

    public function recordLink(Order $order, Admin $admin, array $payment): void
    {
        $this->for($order)->recordLink($order, $admin, $payment);
    }
}
