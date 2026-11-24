<?php

namespace App\Http\Requests;

use App\Http\Controllers\Api\V1\CartController;
use App\Models\Customer;
use App\Models\Product;
use App\Services\BdAddresses;
use App\Services\Settings;
use App\Support\Currency;
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
            'message' => __('Please sign in to check out.'),
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
        // Phase 14: "BD" is stored as the store's spelling; a Bangladesh address takes local mobile formats (01712…).
        $bd = app(BdAddresses::class);
        foreach (['shipping_address', 'billing_address'] as $key) {
            $address = $this->input($key);
            if (is_array($address) && array_key_exists('country', $address)) {
                $this->merge([$key => [...$address, 'country' => $bd->normalizeCountry($address['country'])]]);
            }
        }
        $bangladeshi = BdAddresses::isBangladesh($this->input('shipping_address.country'));

        $this->merge([
            'email' => $email === null ? null : mb_strtolower($email),
            'phone' => $phone === null ? null : ($bangladeshi ? BdAddresses::normalizePhone($phone) : PhoneNumber::normalize($phone)),
        ]);
    }

    /** Phase 14: is the address under $key a structured Bangladesh address (division → district → area)? */
    public function structured(string $key): bool
    {
        return app(BdAddresses::class)->structured($this->input($key));
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

        // Phase 14: structured Bangladesh addresses (ids, optional 4-digit postcode, city/state filled) and mobiles.
        $structured = fn (string $prefix, string $required) => $this->structured($prefix)
            ? BdAddresses::rules("{$prefix}.", $required === 'required') : [];

        return [
            ...CartController::rules(),
            'items' => ['required', 'array', 'min:1', 'max:50'],
            // Only what the settings switch on: a method that is off → 422.
            // Phase 10 (part B): not needed when every item is a gift card (nothing to ship).
            'shipping_method' => [Rule::requiredIf(fn () => ! self::onlyGiftCards($this->input('items'))), 'nullable', 'string',
                Rule::in(array_keys($settings->shippingMethods()))],
            // Phase 10 (part B): "gift_card" when the gift card pays the whole total (see Checkout). Phase 11: "reward_points" likewise.
            'payment_method' => ['required', 'string', Rule::in([...$settings->paymentMethods(), 'gift_card', 'reward_points'])],
            'gift_card_code' => ['nullable', 'string', 'max:40'],
            'email' => ['required', 'string', 'email', 'max:190'],
            'phone' => ['required', 'string', $this->structured('shipping_address') ? BdAddresses::MOBILE_RULE : PhoneNumber::RULE],
            'shipping_address' => ['required', 'array'],
            ...$address('shipping_address', 'required'),
            ...$structured('shipping_address', 'required'),
            'billing_address' => ['nullable', 'array'],
            ...$address('billing_address', 'required_with:billing_address'),
            ...$structured('billing_address', 'required_with:billing_address'),
            'expected_total' => ['nullable', 'numeric', 'min:0'],
            // Phase 6: signed-in customers may add the shipping address to their address book (ignored for guests).
            'save_address' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            ...CartController::messages(),
            'items.required' => __('Your cart is empty.'),
            'items.min' => __('Your cart is empty.'),
            'payment_method.in' => self::paymentMethodMessage($this->input('payment_method')),
            'phone.regex' => $this->structured('shipping_address') ? BdAddresses::mobileMessage()
                : __('Enter the phone number with its country code, for example +1 555 010 0100.'),
            ...BdAddresses::messages(),
            ...($this->structured('shipping_address') || $this->structured('billing_address') ? [] : ['*.postal_code.regex' => __('The postal code is invalid.')]),
            '*.country.in' => __('We don\'t deliver to that country yet.'),
        ];
    }

    public function attributes(): array
    {
        $attributes = [];
        foreach (['shipping_address', 'billing_address'] as $prefix) {
            foreach (['first_name' => 'first name', 'last_name' => 'last name', 'line1' => 'address', 'line2' => 'address line 2',
                'city' => 'city', 'state' => 'state', 'postal_code' => 'postal code', 'country' => 'country',
                'division_id' => 'division', 'district_id' => 'district', 'area_id' => 'area'] as $key => $label) {
                $attributes["{$prefix}.{$key}"] = __($label);
            }
        }

        return $attributes;
    }

    /** Phase 12: why a payment method was refused: the store currency rules some out (PayPal in taka, SSLCommerz outside taka). */
    public static function paymentMethodMessage(mixed $method): string
    {
        return match (true) {
            $method === 'paypal' && ! Currency::paypalAccepts() => __('PayPal doesn\'t accept :currency, so it isn\'t available in this store.', ['currency' => Currency::store()]),
            $method === 'sslcommerz' && ! Currency::sslcommerzAccepts() => __('bKash, Nagad and cards (SSLCommerz) need the store currency BDT.'),
            default => __('Choose a payment method.'),
        };
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

    /** Phase 14: the ids of a structured Bangladesh address must exist and belong together. */
    public function after(): array
    {
        return [function ($validator) {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }
            foreach (['shipping_address', 'billing_address'] as $key) {
                if ($this->structured($key)) {
                    foreach (app(BdAddresses::class)->problems((array) $this->input($key), "{$key}.") as $field => $message) {
                        $validator->errors()->add($field, $message);
                    }
                }
            }
        }];
    }

    /**
     * The address as stored: only the known fields, in a fixed order. Phase 14:
     * a structured Bangladesh address adds division_id, district_id, area_id
     * and area, with city and state filled from the district and division.
     */
    public function address(string $key): ?array
    {
        $address = $this->validated($key);
        if (! $address) {
            return null;
        }

        return self::storedAddress($address, $this->structured($key));
    }

    /** The stored form of a validated address (also used by admin-created orders). */
    public static function storedAddress(array $address, bool $structured): array
    {
        $stored = collect(['first_name', 'last_name', 'line1', 'line2', 'city', 'state', 'postal_code', 'country'])
            ->mapWithKeys(fn ($field) => [$field => isset($address[$field]) ? trim($address[$field]) : null])
            ->all();

        return $structured ? app(BdAddresses::class)->fill([...$stored, ...array_intersect_key($address, array_flip(BdAddresses::ID_FIELDS))]) : $stored;
    }
}
