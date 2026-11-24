<?php

namespace App\Services;

use App\Http\Requests\PhoneNumber;
use App\Models\Customer;
use App\Models\CustomerAddress;
use App\Support\Locale;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * A customer's address book (Magento's customer addresses), for both the
 * storefront (/api/v1/me/addresses) and the admin (/customers/{id}/addresses).
 *
 * - At most 20 addresses per customer.
 * - At most one default shipping and one default billing address: marking
 *   one clears the flag on the others. The first address becomes both
 *   defaults (Magento does the same); deleting a default leaves none.
 * - The country must be one the store ships to (Settings → Checkout).
 */
class AddressBook
{
    public function __construct(private Settings $settings) {}

    /**
     * Validates a POST (all required) or PATCH (only what's sent) body.
     * Phase 14: a Bangladesh address (country "Bangladesh"/"BD") takes local
     * mobile formats; a structured one (division/district/area ids, see
     * BdAddresses) needs the ids (checked together with $existing's for a
     * PATCH), has an optional 4-digit postcode, and gets city/state filled.
     */
    public function validate(Request $request, bool $partial, ?CustomerAddress $existing = null): array
    {
        $bd = app(BdAddresses::class);
        if ($request->has('country')) {
            $request->merge(['country' => $bd->normalizeCountry($request->input('country'))]);
        }
        $merged = [...($existing ? $existing->only(['country', ...BdAddresses::ID_FIELDS]) : []), ...$request->only(['country', ...BdAddresses::ID_FIELDS])];
        $bangladeshi = BdAddresses::isBangladesh($merged['country'] ?? null);
        $structured = $bd->structured($merged);
        if (is_string($request->input('phone'))) {
            $request->merge(['phone' => $bangladeshi ? BdAddresses::normalizePhone($request->input('phone')) : PhoneNumber::normalize($request->input('phone'))]);
        }
        $required = $partial ? ['sometimes', 'required'] : ['required'];
        $optional = $partial ? ['sometimes', 'nullable'] : ['nullable'];
        // A PATCH that turns an address into a structured one must send the ids.
        $newlyStructured = $structured && ! ($existing && $bd->structured($existing->only(['country', ...BdAddresses::ID_FIELDS])));

        $data = $request->validate([
            'first_name' => [...$required, 'string', 'max:60'],
            'last_name' => [...$required, 'string', 'max:60'],
            'company' => [...$optional, 'string', 'max:100'],
            'phone' => [...$required, 'string', $structured ? BdAddresses::MOBILE_RULE : PhoneNumber::RULE],
            'line1' => [...$required, 'string', 'max:120'],
            'line2' => [...$optional, 'string', 'max:120'],
            'city' => [...$required, 'string', 'max:80'],
            'state' => [...$optional, 'string', 'max:80'],
            'postal_code' => [...$required, 'string', 'regex:/^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/'],
            'country' => [...$required, 'string', Rule::in($this->settings->get('allowed_countries'))],
            'is_default_shipping' => ['sometimes', 'boolean'],
            'is_default_billing' => ['sometimes', 'boolean'],
            ...($structured ? BdAddresses::rules('', true, $partial && ! $newlyStructured) : []),
        ], [
            'phone.regex' => $structured ? BdAddresses::mobileMessage() : __('Enter the phone number with its country code, for example +1 555 010 0100.'),
            'postal_code.regex' => $structured ? __('Enter a 4-digit postcode.') : __('The postal code is invalid.'),
            'country.in' => __('We don\'t deliver to that country yet.'),
            ...BdAddresses::messages(''),
        ], [
            'line1' => 'address', 'line2' => 'address line 2', 'postal_code' => 'postal code',
            'division_id' => 'division', 'district_id' => 'district', 'area_id' => 'area',
        ]);

        $data = array_map(fn ($value) => is_string($value) ? (trim($value) === '' ? null : trim($value)) : $value, $data);
        if ($structured) {
            $places = [...$merged, ...array_intersect_key($data, array_flip(BdAddresses::ID_FIELDS))];
            if ($problems = $bd->problems($places)) {
                throw ValidationException::withMessages($problems);
            }
            $filled = $bd->fill([...$places, 'line1' => $data['line1'] ?? $existing?->line1]);
            $data = [...$data, ...array_intersect_key($filled, array_flip(['city', 'state', 'country', ...BdAddresses::ID_FIELDS]))];
        } elseif (array_key_exists('country', $data)) {
            $data = [...$data, 'division_id' => null, 'district_id' => null, 'area_id' => null]; // not a Bangladesh address any more
        }

        return $data;
    }

    public function create(Customer $customer, array $data): CustomerAddress
    {
        return DB::transaction(function () use ($customer, $data) {
            // Lock the customer row: two requests at once can't both add the 20th address.
            Customer::whereKey($customer->id)->lockForUpdate()->first();
            if ($customer->addresses()->count() >= CustomerAddress::MAX_PER_CUSTOMER) {
                throw ValidationException::withMessages(['address' => __('An address book can have at most :max addresses. Delete one first.', ['max' => Locale::digits(CustomerAddress::MAX_PER_CUSTOMER)])]);
            }
            $first = ! $customer->addresses()->exists();
            $address = $customer->addresses()->create([
                ...$data,
                'is_default_shipping' => $first || ($data['is_default_shipping'] ?? false),
                'is_default_billing' => $first || ($data['is_default_billing'] ?? false),
            ]);
            $this->clearOtherDefaults($address);

            return $address;
        });
    }

    public function update(CustomerAddress $address, array $data): CustomerAddress
    {
        return DB::transaction(function () use ($address, $data) {
            $address->fill($data)->save();
            $this->clearOtherDefaults($address);

            return $address;
        });
    }

    public function delete(CustomerAddress $address): void
    {
        $address->delete();
    }

    /**
     * After checkout with "Save this address to my address book": adds the
     * order's address unless the book is full or already has it (same fields,
     * ignoring case and spaces). Returns the new address, or null when skipped.
     */
    public function remember(Customer $customer, array $orderAddress, string $phone): ?CustomerAddress
    {
        $key = fn (array $address) => implode('|', array_map(fn ($field) => mb_strtolower(trim((string) ($address[$field] ?? ''))),
            CustomerAddress::ORDER_FIELDS));
        $existing = $customer->addresses()->get();
        if ($existing->count() >= CustomerAddress::MAX_PER_CUSTOMER
            || $existing->contains(fn (CustomerAddress $address) => $key($address->toOrderAddress()) === $key($orderAddress))) {
            return null;
        }

        return $this->create($customer, [
            ...array_intersect_key($orderAddress, array_flip(CustomerAddress::ORDER_FIELDS)),
            ...array_intersect_key($orderAddress, array_flip(BdAddresses::ID_FIELDS)), // phase 14
            'phone' => $phone,
        ]);
    }

    /** The customer's addresses for the API (defaults first, then oldest first). */
    public function list(Customer $customer): array
    {
        return $customer->addresses()->get()
            ->sortBy(fn (CustomerAddress $a) => [! $a->is_default_shipping, ! $a->is_default_billing, $a->id])
            ->map->toApiArray()->values()->all();
    }

    private function clearOtherDefaults(CustomerAddress $address): void
    {
        foreach (['is_default_shipping', 'is_default_billing'] as $flag) {
            if ($address->{$flag}) {
                CustomerAddress::where('customer_id', $address->customer_id)->whereKeyNot($address->id)->where($flag, true)->update([$flag => false]);
            }
        }
    }
}
