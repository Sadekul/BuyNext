<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Services\Pricing;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** The cart lives in the browser; the server only prices it (no sign-in needed). */
class CartController extends Controller
{
    /** POST /api/v1/cart/validate { items: [{ product_id, quantity }], coupon_code, shipping_method, email? } (optional customer Bearer token) */
    public function validateCart(Request $request, Pricing $pricing): JsonResponse
    {
        $data = $request->validate([...self::rules(), 'email' => ['nullable', 'string', 'email', 'max:190']], self::messages());

        // Who is asking, for per-customer coupon limits: the signed-in customer
        // (optional Bearer token), else the guest's email if the cart sent one.
        $customer = $request->user();
        $customer = $customer instanceof Customer ? $customer : null;

        $quote = $pricing->quote($data['items'], $data['coupon_code'] ?? null, $data['shipping_method'] ?? 'standard',
            customerId: $customer?->id, email: $customer ? null : ($data['email'] ?? null));

        return response()->json(['data' => $quote->toArray()]);
    }

    /** The cart part of the rules, shared with checkout (OrderController). */
    public static function rules(): array
    {
        return [
            'items' => ['present', 'array', 'max:50'],
            'items.*.product_id' => ['required', 'integer', 'min:1'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:999'],
            'coupon_code' => ['nullable', 'string', 'max:40'],
            'shipping_method' => ['nullable', 'string', 'in:'.implode(',', array_keys(config('buynest.store.shipping_methods')))],
        ];
    }

    public static function messages(): array
    {
        return [
            'items.max' => 'A cart can have at most 50 different products.',
            'items.*.quantity.min' => 'The quantity must be at least 1.',
            'items.*.quantity.max' => 'The quantity can be at most 999.',
            'shipping_method.in' => 'Choose a shipping method.',
        ];
    }
}
