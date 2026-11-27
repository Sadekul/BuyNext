<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\Sms\ConfirmLinks;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Phase 20: the one-tap confirmation link of a cash on delivery order
 * ({storefront}/c/{token}; see ConfirmLinks). No sign-in: the token is the
 * proof. Only the order number, total, item count, date and status are
 * shown, never the address, phone or name.
 */
class OrderConfirmationLinkController extends Controller
{
    public function __construct(private ConfirmLinks $links) {}

    /**
     * GET /api/v1/order-confirmations/{token} → { data: { number, total, items_count, placed_at,
     * status: pending|confirmed|cancelled|expired|not_waiting } }; 404 for an unknown token. Changes nothing.
     */
    public function show(string $token): JsonResponse
    {
        $order = $this->links->find($token);

        return $order ? response()->json(['data' => ConfirmLinks::summary($order)]) : $this->notFound();
    }

    /**
     * POST /api/v1/order-confirmations/{token} { action: confirm|cancel, reason? } → { data: (as GET) }.
     * 404 for an unknown or expired link; 422 { errors: { token } } when the order isn't waiting any more.
     */
    public function store(Request $request, string $token): JsonResponse
    {
        $data = $request->validate([
            'action' => ['required', Rule::in(['confirm', 'cancel'])],
            'reason' => ['nullable', 'string', 'max:500'],
        ], ['action.required' => __('Choose confirm or cancel.'), 'action.in' => __('Choose confirm or cancel.')]);
        $order = $this->links->find($token);
        if (! $order) {
            return $this->notFound();
        }
        // A result stays visible after the expiry; only a pending order's link expires.
        if (ConfirmLinks::status($order) === 'expired') {
            return response()->json(['message' => __('This confirmation link has expired. Please contact us to confirm your order.')], 404);
        }

        return response()->json(['data' => ConfirmLinks::summary($this->links->act($order, $data['action'], $data['reason'] ?? null))]);
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => __('This confirmation link isn\'t valid. Please check the link in your SMS.')], 404);
    }
}
