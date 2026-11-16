<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\V1\CartController;
use App\Http\Controllers\Controller;
use App\Http\Requests\PhoneNumber;
use App\Http\Resources\AdminOrderResource;
use App\Models\Customer;
use App\Models\Order;
use App\Services\Checkout;
use App\Services\OneTimeCodes;
use App\Services\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Orders staff create for a customer or a guest (Magento's Sales → Orders →
 * Create new order; "phone orders"). Priced and placed by the same Checkout
 * service as the storefront (server prices, group discount, coupons, tax,
 * stock checks with row locks), so the totals can never differ.
 *
 * Body (quote and create):
 *   { customer_id | guest: { email, phone, first_name, last_name },
 *     items: [{ product_id, variant_id?, quantity }],
 *     shipping_address, billing_address | same_as_shipping: true,
 *     shipping_method, payment_method, coupon_code?, note?, notify_customer?, expected_total? }
 */
class OrderCreateController extends Controller
{
    private const ADDRESS_FIELDS = ['first_name', 'last_name', 'line1', 'line2', 'city', 'state', 'postal_code', 'country'];

    public function __construct(private Settings $settings) {}

    /**
     * POST /api/admin/v1/orders/quote - the totals, like cart/validate (200
     * with `problems` and `coupon_error`; nothing is saved, no stock taken).
     * Only `items` is required (the customer or guest, addresses, and methods
     * are optional), so the page can show live totals while the form is being
     * filled.
     */
    public function quote(Request $request, Checkout $checkout): JsonResponse
    {
        $data = $this->validated($request, quote: true);
        $customer = $this->customer($data);
        $quote = $checkout->quote([
            'items' => $data['items'],
            'coupon_code' => $data['coupon_code'] ?? null,
            'shipping_method' => $data['shipping_method'] ?? $this->settings->defaultShippingMethod(),
            'email' => $customer?->email ?? ($data['guest']['email'] ?? null),
            'shipping_address' => $data['shipping_address'] ?? null,
        ], $customer);

        return response()->json(['data' => [
            ...$quote->toArray(),
            'payment_methods' => $this->settings->adminPaymentMethods(),
        ]]);
    }

    /** POST /api/admin/v1/orders → 201 { data: AdminOrderResource } (source "admin"). */
    public function store(Request $request, Checkout $checkout): JsonResponse
    {
        $data = $this->validated($request, quote: false);
        $customer = $this->customer($data);
        $shipping = $this->address($data['shipping_address']);
        $sameAsShipping = filter_var($data['same_as_shipping'] ?? false, FILTER_VALIDATE_BOOLEAN) || empty($data['billing_address']);

        $order = $checkout->place([
            'items' => $data['items'],
            'coupon_code' => $data['coupon_code'] ?? null,
            'shipping_method' => $data['shipping_method'],
            'payment_method' => $data['payment_method'],
            'email' => $customer ? $customer->email : $data['guest']['email'],
            'phone' => $customer ? $customer->phone : $data['guest']['phone'],
            'shipping_address' => $shipping,
            'billing_address' => $sameAsShipping ? $shipping : $this->address($data['billing_address']),
            'expected_total' => $data['expected_total'] ?? null,
            'note' => $data['note'] ?? null,
        ], $customer, $request->user(), notify: (bool) ($data['notify_customer'] ?? true));

        $order = Order::with(['items', 'customer', 'createdBy', 'history.admin', ...Order::DOCUMENTS])->find($order->id);

        return (new AdminOrderResource($order))->response()->setStatusCode(201);
    }

    private function validated(Request $request, bool $quote): array
    {
        $guest = $request->input('guest');
        if (is_array($guest)) {
            $request->merge(['guest' => [
                ...$guest,
                'email' => is_string($guest['email'] ?? null) ? OneTimeCodes::normalize($guest['email']) : ($guest['email'] ?? null),
                'phone' => is_string($guest['phone'] ?? null) ? PhoneNumber::normalize($guest['phone']) : ($guest['phone'] ?? null),
            ]]);
        }
        $countries = $this->settings->get('allowed_countries');
        $need = $quote ? 'nullable' : 'required';
        // Required only for the shipping address when placing the order; the
        // billing address (when sent and not "same as shipping") is checked below.
        $address = function (string $prefix, bool $required) use ($quote, $countries) {
            $need = $required && ! $quote ? 'required' : 'nullable';

            return [
                $prefix => [$need, 'array'],
                "{$prefix}.first_name" => [$need, 'string', 'max:60'],
                "{$prefix}.last_name" => [$need, 'string', 'max:60'],
                "{$prefix}.line1" => [$need, 'string', 'max:120'],
                "{$prefix}.line2" => ['nullable', 'string', 'max:120'],
                "{$prefix}.city" => [$need, 'string', 'max:80'],
                "{$prefix}.state" => ['nullable', 'string', 'max:80'],
                "{$prefix}.postal_code" => [$need, 'string', 'regex:/^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/'],
                "{$prefix}.country" => [$need, 'string', Rule::in($countries)],
            ];
        };

        $data = $request->validate([
            ...CartController::rules(),
            'items' => $quote ? ['present', 'array', 'max:50'] : ['required', 'array', 'min:1', 'max:50'],
            'customer_id' => ['nullable', 'integer', ...($quote ? [] : ['required_without:guest']), 'prohibits:guest'],
            'guest' => ['nullable', 'array', ...($quote ? [] : ['required_without:customer_id'])],
            'guest.email' => [$quote ? 'nullable' : 'required_with:guest', 'string', 'email', 'max:190'],
            'guest.phone' => [$quote ? 'nullable' : 'required_with:guest', 'string', PhoneNumber::RULE],
            'guest.first_name' => [$quote ? 'nullable' : 'required_with:guest', 'string', 'max:60'],
            'guest.last_name' => [$quote ? 'nullable' : 'required_with:guest', 'string', 'max:60'],
            ...$address('shipping_address', true),
            ...$address('billing_address', false),
            'same_as_shipping' => ['nullable', 'boolean'],
            'shipping_method' => [$need, 'string', Rule::in(array_keys($this->settings->shippingMethods()))],
            // The store's enabled methods, plus bank transfer and cash (staff only).
            'payment_method' => [$need, 'string', Rule::in($this->settings->adminPaymentMethods())],
            'note' => ['nullable', 'string', 'max:1000'],
            'notify_customer' => ['nullable', 'boolean'],
            'expected_total' => ['nullable', 'numeric', 'min:0'],
        ], [
            ...CartController::messages(),
            'items.required' => 'Add at least one product.',
            'items.min' => 'Add at least one product.',
            'customer_id.required_without' => 'Choose a customer, or enter the guest\'s details.',
            'guest.required_without' => 'Choose a customer, or enter the guest\'s details.',
            'customer_id.prohibits' => 'Choose a customer or enter a guest, not both.',
            'payment_method.in' => 'Choose a payment method.',
            'guest.phone.regex' => 'Enter the phone number with its country code, for example +1 555 010 0100.',
            '*.postal_code.regex' => 'The postal code is invalid.',
            '*.country.in' => 'We don\'t deliver to that country yet.',
        ]);

        if (! $quote && ! filter_var($data['same_as_shipping'] ?? false, FILTER_VALIDATE_BOOLEAN) && ! empty($data['billing_address'])) {
            // A billing address that's sent must be complete (required_with only checks the keys exist).
            $missing = array_filter(['first_name', 'last_name', 'line1', 'city', 'postal_code', 'country'],
                fn ($field) => blank($data['billing_address'][$field] ?? null));
            if ($missing) {
                throw ValidationException::withMessages(array_combine(
                    array_map(fn ($field) => "billing_address.{$field}", $missing),
                    array_map(fn ($field) => 'The '.str_replace('_', ' ', $field).' field is required.', $missing),
                ));
            }
        }

        return $data;
    }

    /** The chosen customer (must exist and not be blocked), or null for a guest. */
    private function customer(array $data): ?Customer
    {
        if (empty($data['customer_id'])) {
            return null;
        }
        $customer = Customer::with('group')->find($data['customer_id']);
        if (! $customer) {
            throw ValidationException::withMessages(['customer_id' => 'Choose a customer.']);
        }
        if (! $customer->is_active) {
            throw ValidationException::withMessages(['customer_id' => 'This customer is blocked. Unblock the account to place an order for them.']);
        }

        return $customer;
    }

    private function address(array $address): array
    {
        return collect(self::ADDRESS_FIELDS)
            ->mapWithKeys(fn ($field) => [$field => isset($address[$field]) && trim((string) $address[$field]) !== '' ? trim($address[$field]) : null])
            ->all();
    }
}
