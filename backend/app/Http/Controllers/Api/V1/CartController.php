<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Services\CustomerCarts;
use App\Services\DeliveryZones;
use App\Services\Pricing;
use App\Services\ProductLinks;
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
    public function validateCart(Request $request, Pricing $pricing, ProductLinks $links): JsonResponse
    {
        $data = $request->validate([
            ...self::rules(),
            'email' => ['nullable', 'string', 'email', 'max:190'],
            'country' => ['nullable', 'string', 'max:60'],
            // Phase 14: a Bangladesh area (and district) picks the delivery zone's rates; payment_method "cod" adds the COD fee.
            'area_id' => ['nullable', 'integer', 'min:1'],
            'district_id' => ['nullable', 'integer', 'min:1'],
            'payment_method' => ['nullable', 'string', 'max:30'],
        ], self::messages());
        $zone = app(DeliveryZones::class)->forAddress(['country' => $data['country'] ?? null, 'area_id' => $data['area_id'] ?? null,
            'district_id' => $data['district_id'] ?? null]);

        // Who is asking, for per-customer coupon limits: the signed-in customer
        // (optional Bearer token), else the guest's email if the cart sent one.
        $customer = $request->user();
        $customer = $customer instanceof Customer ? $customer : null;

        // Phase 10 (part B): without a shipping_method the default (or the first available) method is used; gift_card_code redeems a card.
        $quote = $pricing->quote($data['items'], $data['coupon_code'] ?? null, $data['shipping_method'] ?? null,
            customerId: $customer?->id, email: $customer ? null : ($data['email'] ?? null), country: $data['country'] ?? null,
            group: $customer?->priceGroup(), // phase 6: the customer's group price (guests: General)
            giftCardCode: $data['gift_card_code'] ?? null,
            rewardsCustomer: $customer, rewardPoints: $data['reward_points'] ?? null, // phase 11
            deliveryZone: $zone?->code, paymentMethod: $data['payment_method'] ?? null); // phase 14

        // Phase 7: a signed-in customer's cart is saved (restore on another device, abandoned carts report).
        if ($customer) {
            app(CustomerCarts::class)->save($customer, $data['items'], $quote->subtotalCents);
        }

        // Phase 11: "Customers also bought": cross-sells of the cart's products.
        $productIds = collect($quote->lines)->filter(fn ($line) => $line['available'])->pluck('product_id')->all();

        return response()->json(['data' => [...$quote->toArray(), 'cross_sells' => $links->crossSells($productIds, $request)]]);
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
            // Phase 10 (part B): a gift card line's amount and recipient, and a gift card to pay with.
            'items.*.gift_card' => ['nullable', 'array'],
            'items.*.gift_card.amount' => ['required_with:items.*.gift_card', 'numeric', 'decimal:0,2', 'min:0.01', 'max:100000'],
            'items.*.gift_card.recipient_name' => ['required_with:items.*.gift_card', 'string', 'max:120'],
            'items.*.gift_card.recipient_email' => ['required_with:items.*.gift_card', 'string', 'email', 'max:190'],
            'items.*.gift_card.message' => ['nullable', 'string', 'max:500'],
            'gift_card_code' => ['nullable', 'string', 'max:40'],
            // Phase 11: reward points to spend (signed-in customers, rewards on).
            'reward_points' => ['nullable', 'integer', 'min:0', 'max:100000000'],
        ];
    }

    public static function messages(): array
    {
        return [
            'items.max' => __('A cart can have at most 50 different products.'),
            'items.*.quantity.min' => __('The quantity must be at least 1.'),
            'items.*.quantity.max' => __('The quantity can be at most 999.'),
            'shipping_method.in' => __('Choose a shipping method.'),
            'items.*.gift_card.amount.required_with' => __('Choose a gift card amount.'),
            'items.*.gift_card.recipient_name.required_with' => __('Enter the recipient\'s name.'),
            'items.*.gift_card.recipient_email.required_with' => __('Enter the recipient\'s email.'),
            'items.*.gift_card.recipient_email.email' => __('Enter a valid email address for the recipient.'),
        ];
    }
}
