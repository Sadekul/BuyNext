<?php

namespace App\Http\Requests;

use App\Http\Controllers\Api\V1\CartController;
use App\Models\Customer;
use App\Models\Product;
use App\Services\Settings;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/orders. Prices are never accepted: only product ids and
 * quantities. A signed-in customer's email and phone default to the account's.
 */
class PlaceOrderRequest extends FormRequest
{
    /** Guests may check out only while guest checkout is on (Settings → Checkout). */
    public function authorize(): bool
    {
        return $this->customer() !== null || (bool) app(Settings::class)->get('guest_checkout');
    }

    protected function failedAuthorization(): void
    {
        throw new HttpResponseException(response()->json([
            'message' => 'Please sign in to check out.',
            'code' => 'guest_checkout_disabled',
        ], 403));
    }

    public function customer(): ?Customer
    {
        $user = $this->user();

        return $user instanceof Customer ? $user : null;
    }

    protected function prepareForValidation(): void
    {
        $customer = $this->customer();
        $email = trim((string) $this->input('email')) ?: $customer?->email;
        $phone = trim((string) $this->input('phone')) ?: $customer?->phone;

        $this->merge([
            'email' => $email === null ? null : mb_strtolower($email),
            'phone' => $phone === null ? null : PhoneNumber::normalize($phone),
        ]);
    }

    public function rules(): array
    {
        $settings = app(Settings::class);
        $address = fn (string $prefix, string $required) => [
            "{$prefix}.first_name" => [$required, 'string', 'max:60'],
            "{$prefix}.last_name" => [$required, 'string', 'max:60'],
            "{$prefix}.line1" => [$required, 'string', 'max:120'],
            "{$prefix}.line2" => ['nullable', 'string', 'max:120'],
            "{$prefix}.city" => [$required, 'string', 'max:80'],
            "{$prefix}.state" => ['nullable', 'string', 'max:80'],
            "{$prefix}.postal_code" => [$required, 'string', 'regex:/^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/'],
            "{$prefix}.country" => [$required, 'string', Rule::in($settings->get('allowed_countries'))],
        ];

        return [
            ...CartController::rules(),
            'items' => ['required', 'array', 'min:1', 'max:50'],
            // Only what the settings switch on: a method that is off → 422.
            // Phase 10 (part B): not needed when every item is a gift card (nothing to ship).
            'shipping_method' => [Rule::requiredIf(fn () => ! self::onlyGiftCards($this->input('items'))), 'nullable', 'string',
                Rule::in(array_keys($settings->shippingMethods()))],
            // Phase 10 (part B): "gift_card" when the gift card pays the whole total (see Checkout).
            'payment_method' => ['required', 'string', Rule::in([...$settings->paymentMethods(), 'gift_card'])],
            'gift_card_code' => ['nullable', 'string', 'max:40'],
            'email' => ['required', 'string', 'email', 'max:190'],
            'phone' => ['required', 'string', PhoneNumber::RULE],
            'shipping_address' => ['required', 'array'],
            ...$address('shipping_address', 'required'),
            'billing_address' => ['nullable', 'array'],
            ...$address('billing_address', 'required_with:billing_address'),
            'expected_total' => ['nullable', 'numeric', 'min:0'],
            // Phase 6: signed-in customers may add the shipping address to their address book (ignored for guests).
            'save_address' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            ...CartController::messages(),
            'items.required' => 'Your cart is empty.',
            'items.min' => 'Your cart is empty.',
            'payment_method.in' => 'Choose a payment method.',
            'phone.regex' => 'Enter the phone number with its country code, for example +1 555 010 0100.',
            '*.postal_code.regex' => 'The postal code is invalid.',
            '*.country.in' => 'We don\'t deliver to that country yet.',
        ];
    }

    public function attributes(): array
    {
        $attributes = [];
        foreach (['shipping_address', 'billing_address'] as $prefix) {
            foreach (['first_name' => 'first name', 'last_name' => 'last name', 'line1' => 'address', 'line2' => 'address line 2',
                'city' => 'city', 'state' => 'state', 'postal_code' => 'postal code', 'country' => 'country'] as $key => $label) {
                $attributes["{$prefix}.{$key}"] = $label;
            }
        }

        return $attributes;
    }

    /** Phase 10 (part B): are all $items (as sent) gift card products? Then no shipping method is needed. */
    public static function onlyGiftCards(mixed $items): bool
    {
        if (! is_array($items) || $items === []) {
            return false;
        }
        $ids = collect($items)->map(fn ($item) => is_array($item) && is_numeric($item['product_id'] ?? null) ? (int) $item['product_id'] : 0)->unique();
        if ($ids->contains(0)) {
            return false;
        }

        return Product::withTrashed()->whereIn('id', $ids)->where('type', 'gift_card')->count() === $ids->count();
    }

    /** The address as stored: only the known fields, in a fixed order. */
    public function address(string $key): ?array
    {
        $address = $this->validated($key);
        if (! $address) {
            return null;
        }

        return collect(['first_name', 'last_name', 'line1', 'line2', 'city', 'state', 'postal_code', 'country'])
            ->mapWithKeys(fn ($field) => [$field => isset($address[$field]) ? trim($address[$field]) : null])
            ->all();
    }
}
