<?php

namespace App\Services\Payments;

use App\Models\Admin;
use App\Models\Order;

/**
 * Phase 10 (part B): one door to the online payment providers. Card orders
 * go to Stripe (phase 8), PayPal orders to PayPal; everything that used to
 * ask StripePayments directly (order answers, Pay now, staff payment links,
 * staff cancel, refunds) asks this class, so each provider keeps its own rules.
 * Phase 12: SSLCommerz orders go to SSLCommerz.
 */
class OnlinePayments
{
    public function __construct(private StripePayments $stripe, private PayPalPayments $paypal, private SslCommerzPayments $sslcommerz) {}

    /** The provider service for $order: PayPal / SSLCommerz for their orders (or ones they took), else Stripe. */
    public function for(Order $order): StripePayments|PayPalPayments|SslCommerzPayments
    {
        return match (true) {
            $order->payment_method === 'paypal' || $order->payment_provider === 'paypal' => $this->paypal,
            // Phase 12.
            $order->payment_method === 'sslcommerz' || $order->payment_provider === 'sslcommerz' => $this->sslcommerz,
            default => $this->stripe,
        };
    }

    /** Is the order paid online (provider on) and is there something left to pay? */
    public function uses(Order $order): bool
    {
        $uses = match ($order->payment_method) {
            'paypal' => $this->paypal->usesPayPal($order),
            'sslcommerz' => $this->sslcommerz->usesSslCommerz($order),
            default => $this->stripe->usesStripe($order),
        };

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

    /** Phase 12: every summary also has method_label ("bKash"; null unless SSLCommerz said), staff also get sslcommerz (details or null). */
    public function summary(Order $order, bool $forStaff): array
    {
        return [
            ...$this->for($order)->summary($order, $forStaff),
            'method_label' => SslCommerzPayments::methodLabel($order),
            ...($forStaff ? ['sslcommerz' => $this->sslcommerz->staffDetails($order)] : []),
        ];
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
            'sslcommerz' => $this->sslcommerz->refund($order, $cents, $memoNumber), // phase 12
            default => null,
        };
    }

    public function recordLink(Order $order, Admin $admin, array $payment): void
    {
        $this->for($order)->recordLink($order, $admin, $payment);
    }
}
