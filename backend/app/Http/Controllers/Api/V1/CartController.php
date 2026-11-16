<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Services\CustomerCarts;
use App\Services\Pricing;
use App\Services\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** The cart lives in the browser; the server only prices it (no sign-in needed). */
class CartController extends Controller
{
    /**
     * POST /api/v1/cart/validate { items: [{ product_id, variant_id?, quantity }], coupon_code, shipping_method, email?, country? }
     * (optional customer Bearer token). country: the shipping country, for tax; without it the
     * tax is 0 and tax_estimated is false (when tax is on).
     */
    public function validateCart(Request $request, Pricing $pricing, Settings $settings): JsonResponse
    {
        $data = $request->validate([
            ...self::rules(),
            'email' => ['nullable', 'string', 'email', 'max:190'],
            'country' => ['nullable', 'string', 'max:60'],
        ], self::messages());

        // Who is asking, for per-customer coupon limits: the signed-in customer
        // (optional Bearer token), else the guest's email if the cart sent one.
        $customer = $request->user();
        $customer = $customer instanceof Customer ? $customer : null;

        $quote = $pricing->quote($data['items'], $data['coupon_code'] ?? null, $data['shipping_method'] ?? $settings->defaultShippingMethod(),
            customerId: $customer?->id, email: $customer ? null : ($data['email'] ?? null), country: $data['country'] ?? null,
            group: $customer?->priceGroup()); // phase 6: the customer's group price (guests: General)

        // Phase 7: a signed-in customer's cart is saved (restore on another device, abandoned carts report).
        if ($customer) {
            app(CustomerCarts::class)->save($customer, $data['items'], $quote->subtotalCents);
        }

        return response()->json(['data' => $quote->toArray()]);
    }

    /** The cart part of the rules, shared with checkout (OrderController). */
    public static function rules(): array
    {
        return [
            'items' => ['present', 'array', 'max:50'],
            'items.*.product_id' => ['required', 'integer', 'min:1'],
            // Phase 5: products with options sell only through a variant (see Pricing::problemWith()).
            'items.*.variant_id' => ['nullable', 'integer', 'min:1'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:999'],
            'coupon_code' => ['nullable', 'string', 'max:40'],
            // Only the methods switched on in the settings; any other → 422.
            'shipping_method' => ['nullable', 'string', Rule::in(array_keys(app(Settings::class)->shippingMethods()))],
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
