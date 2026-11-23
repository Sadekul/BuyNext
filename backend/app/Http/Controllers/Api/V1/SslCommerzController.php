<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\Payments\SslCommerzException;
use App\Services\Payments\SslCommerzPayments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Phase 12: SSLCommerz's two ways back to the store. No sign-in on either
 * (SSLCommerz posts from its own domain, so the shopper's cookies don't come
 * along); the store's sign-in service forwards both.
 *
 * - POST /api/v1/payments/sslcommerz/return { result, tran_id, val_id?, status?, value_a? }
 *   The shopper's browser came back (success_url / fail_url / cancel_url).
 *   → 200 { data: { order_number, result, confirmation: success|failed|cancelled } }
 *   The posted status is never trusted: "success" validates val_id with SSLCommerz.
 * - POST /api/v1/payments/sslcommerz/ipn (SSLCommerz's form body, unchanged)
 *   → 200 { received: true, result }; 400 when it isn't usable; 503 when
 *   SSLCommerz can't be reached to validate it (SSLCommerz retries).
 */
class SslCommerzController extends Controller
{
    public function return(Request $request, SslCommerzPayments $payments): JsonResponse
    {
        $data = $request->validate([
            'result' => ['required', 'string', 'in:success,fail,cancel'],
            'tran_id' => ['required', 'string', 'max:64', 'regex:/^[A-Za-z0-9_-]+-\d+$/'],
            'val_id' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', 'string', 'max:40'],
            'value_a' => ['nullable', 'string', 'max:255'],
        ], [
            'result.in' => __('The result must be success, fail, or cancel.'),
            'tran_id.regex' => __('This isn\'t an SSLCommerz transaction of this store.'),
        ]);

        [$number, $result] = $payments->handleReturn($data['result'], trim($data['tran_id']), filled($data['val_id'] ?? null) ? trim($data['val_id']) : null);

        return response()->json(['data' => [
            'order_number' => $number,
            'result' => $result,
            'confirmation' => match (true) {
                $result === 'cancelled' => 'cancelled',
                in_array($result, SslCommerzPayments::SUCCESS_OUTCOMES, true) => 'success',
                default => 'failed',
            },
        ]]);
    }

    public function ipn(Request $request, SslCommerzPayments $payments): JsonResponse
    {
        // The form body as SSLCommerz sent it (a JSON body is accepted too, for tools).
        $post = $request->isJson() ? $request->json()->all() : $request->request->all();
        $post = array_filter($post, fn ($value) => is_scalar($value));

        try {
            $result = $payments->handleIpn($post);
        } catch (SslCommerzException $e) {
            return response()->json(['message' => 'SSLCommerz could not be reached to validate the notification.'], 503);
        }
        if ($result === null) {
            Log::notice('SSLCommerz IPN refused: not usable.', ['ip' => $request->ip(), 'tran_id' => $post['tran_id'] ?? null]);

            return response()->json(['message' => 'Invalid SSLCommerz notification.'], 400);
        }

        return response()->json(['received' => true, 'result' => $result]);
    }
}
