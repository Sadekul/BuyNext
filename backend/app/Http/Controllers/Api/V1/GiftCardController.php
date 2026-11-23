<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\GiftCards;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/** Phase 10 (part B): shoppers check a gift card's balance. */
class GiftCardController extends Controller
{
    /**
     * POST /api/v1/gift-cards/check { code } → { data: { last4, balance, currency, expires_at, status } }.
     * Unknown, disabled, and expired codes get the same 422, so codes can't be probed
     * (and the route is rate-limited per visitor).
     */
    public function check(Request $request, GiftCards $giftCards): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'string', 'max:40']], ['code.required' => __('Enter the gift card code.')]);
        $card = $giftCards->usable($data['code']);
        if (! $card) {
            throw ValidationException::withMessages(['code' => __(GiftCards::INVALID)]);
        }

        return response()->json(['data' => [
            'last4' => $card->last4,
            'balance' => $card->balance,
            'currency' => $card->currency,
            'expires_at' => $card->expires_at?->toIso8601ZuluString(),
            'status' => $card->effectiveStatus(),
        ]]);
    }
}
