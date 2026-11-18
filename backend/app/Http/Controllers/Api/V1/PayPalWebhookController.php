<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\Payments\PayPalException;
use App\Services\Payments\PayPalGateway;
use App\Services\Payments\PayPalPayments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Phase 10 (part B): POST /api/v1/payments/paypal/webhook - PayPal tells us
 * about captures, approvals, and refunds. No sign-in: the event is checked
 * with PayPal's verify-webhook-signature API (PAYPAL_WEBHOOK_ID + the
 * PAYPAL-* headers). The storefront's sign-in service forwards it with the
 * body unchanged.
 *
 * 400 { message } when it isn't genuine; 503 when PayPal can't be reached to
 * check it (PayPal retries); otherwise 200 { received: true, result }.
 */
class PayPalWebhookController extends Controller
{
    private const HEADERS = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];

    public function __invoke(Request $request, PayPalGateway $gateway, PayPalPayments $payments): JsonResponse
    {
        $headers = [];
        foreach (self::HEADERS as $name) {
            $headers[$name] = $request->header($name);
        }

        try {
            $event = $gateway->verifyWebhook($request->getContent(), $headers);
        } catch (PayPalException $e) {
            return response()->json(['message' => 'PayPal could not be reached to verify the event.'], 503);
        }
        if (! $event) {
            Log::notice('PayPal webhook refused: not verified.', ['ip' => $request->ip(), 'transmission_id' => $headers['paypal-transmission-id']]);

            return response()->json(['message' => 'Invalid PayPal signature.'], 400);
        }

        return response()->json(['received' => true, 'result' => $payments->handleWebhook($event)]);
    }
}
