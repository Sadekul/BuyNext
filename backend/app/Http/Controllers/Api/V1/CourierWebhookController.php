<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\Couriers\CourierGateway;
use App\Services\Couriers\Couriers;
use App\Services\Couriers\PathaoGateway;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Phase 18: the couriers' status webhooks. No sign-in (the courier posts from
 * its own servers, straight to the API, not through the storefront's
 * sign-in service); the shared secret is the proof, compared with
 * hash_equals. Rate-limited (throttle:120,1).
 *
 * - POST /api/v1/couriers/steadfast/webhook (Authorization: Bearer {STEADFAST_WEBHOOK_TOKEN})
 *   → 200 { status: "success", message: "Webhook received successfully." }
 * - POST /api/v1/couriers/pathao/webhook (X-PATHAO-Signature: {PATHAO_WEBHOOK_SECRET})
 *   → 202 with X-Pathao-Merchant-Webhook-Integration-Secret (Pathao's integration check).
 *
 * Missing or wrong secret → 401, nothing changed. Secret not configured → 404.
 * An unknown consignment is answered as received (a no-op and a log line), so
 * the courier doesn't retry forever.
 */
class CourierWebhookController extends Controller
{
    public function __construct(private Couriers $couriers) {}

    public function steadfast(Request $request): JsonResponse
    {
        $gateway = $this->couriers->gateway('steadfast');
        if ($refused = $this->refused($gateway, $request)) {
            return $refused;
        }
        $this->handle($gateway, $request);

        return response()->json(['status' => 'success', 'message' => 'Webhook received successfully.']);
    }

    public function pathao(Request $request): JsonResponse
    {
        /** @var PathaoGateway $gateway */
        $gateway = $this->couriers->gateway('pathao');
        if ($refused = $this->refused($gateway, $request)) {
            return $refused;
        }
        $this->handle($gateway, $request);

        return response()->json(['status' => 'success', 'message' => 'Webhook received.'], 202)
            ->header('X-Pathao-Merchant-Webhook-Integration-Secret', $gateway->webhookSecret());
    }

    private function refused(CourierGateway $gateway, Request $request): ?JsonResponse
    {
        if (! $gateway->webhookConfigured()) {
            return response()->json(['message' => 'Not found.'], 404);
        }
        if (! $gateway->authorizeWebhook($request)) {
            Log::warning('A courier webhook was refused: missing or wrong secret.', ['courier' => $gateway->key()]);

            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        return null;
    }

    private function handle(CourierGateway $gateway, Request $request): void
    {
        $payload = $request->json()->all();
        $parsed = $gateway->parseWebhook(is_array($payload) ? $payload : []);
        if (! $parsed) {
            // An integration check, or an event without a status: nothing to do.
            return;
        }
        [$consignment, $result] = $parsed;
        $this->couriers->receive($gateway->key(), $consignment, $result);
    }
}
