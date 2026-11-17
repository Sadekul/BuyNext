<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\Payments\StripeGateway;
use App\Services\Payments\StripePayments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Phase 8: POST /api/v1/payments/stripe/webhook - Stripe tells us a payment
 * page was paid or expired. No sign-in: the Stripe-Signature header (signed
 * with STRIPE_WEBHOOK_SECRET over the raw body) proves it came from Stripe.
 * The storefront's sign-in service forwards it with the body unchanged.
 *
 * 400 { message } when the signature is missing, wrong, or older than 5
 * minutes; otherwise 200 { received: true, result } (also for events we
 * ignore, and events already handled: Stripe stops retrying on 200).
 */
class StripeWebhookController extends Controller
{
    public function __invoke(Request $request, StripeGateway $gateway, StripePayments $payments): JsonResponse
    {
        $event = $gateway->verifyWebhook($request->getContent(), $request->header('Stripe-Signature'));
        if (! $event) {
            Log::notice('Stripe webhook refused: invalid or stale signature.', ['ip' => $request->ip()]);

            return response()->json(['message' => 'Invalid Stripe signature.'], 400);
        }

        return response()->json(['received' => true, 'result' => $payments->handleWebhook($event)]);
    }
}
