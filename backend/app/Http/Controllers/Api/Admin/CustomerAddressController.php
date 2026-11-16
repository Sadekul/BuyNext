<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\CustomerAddress;
use App\Services\AddressBook;
use App\Services\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

/** A customer's address book, edited by staff (same rules as the storefront: AddressBook). */
class CustomerAddressController extends Controller
{
    private const FIELDS = ['first_name', 'last_name', 'company', 'phone', 'line1', 'line2', 'city', 'state', 'postal_code', 'country',
        'is_default_shipping', 'is_default_billing'];

    public function __construct(private AddressBook $book, private Audit $audit) {}

    /** GET /api/admin/v1/customers/{id}/addresses */
    public function index(int $id): JsonResponse
    {
        $customer = Customer::find($id);

        return $customer ? response()->json(['data' => $this->book->list($customer)]) : $this->notFound('Customer not found.');
    }

    /** POST /api/admin/v1/customers/{id}/addresses → 201 */
    public function store(Request $request, int $id): JsonResponse
    {
        $customer = Customer::find($id);
        if (! $customer) {
            return $this->notFound('Customer not found.');
        }
        $data = $this->book->validate($request, partial: false);
        $address = DB::transaction(function () use ($customer, $data) {
            $address = $this->book->create($customer, $data);
            $this->audit->record('customer.address_added', "Address added for customer {$customer->email}.", 'customer', $customer->id,
                Audit::created(Audit::fieldsOf($address->refresh(), self::FIELDS)));

            return $address;
        });

        return response()->json(['data' => $address->refresh()->toApiArray()], 201);
    }

    /** PATCH /api/admin/v1/customers/{id}/addresses/{address} */
    public function update(Request $request, int $id, int $address): JsonResponse
    {
        $entry = CustomerAddress::where('customer_id', $id)->find($address);
        if (! $entry) {
            return $this->notFound('Address not found.');
        }
        $data = $this->book->validate($request, partial: true);
        DB::transaction(function () use ($entry, $data) {
            $before = Audit::fieldsOf($entry, self::FIELDS);
            $this->book->update($entry, $data);
            $diff = Audit::diff($before, Audit::fieldsOf($entry->refresh(), self::FIELDS));
            if ($diff) {
                $this->audit->record('customer.address_updated', "Address updated for customer {$entry->customer->email}.", 'customer',
                    $entry->customer_id, $diff);
            }
        });

        return response()->json(['data' => $entry->refresh()->toApiArray()]);
    }

    /** DELETE /api/admin/v1/customers/{id}/addresses/{addressId} → 204 */
    public function destroy(int $id, int $address): Response|JsonResponse
    {
        $entry = CustomerAddress::where('customer_id', $id)->find($address);
        if (! $entry) {
            return $this->notFound('Address not found.');
        }
        DB::transaction(function () use ($entry) {
            $before = Audit::fieldsOf($entry, self::FIELDS);
            $this->book->delete($entry);
            $this->audit->record('customer.address_deleted', "Address deleted for customer {$entry->customer->email}.", 'customer',
                $entry->customer_id, Audit::deleted($before));
        });

        return response()->noContent();
    }

    private function notFound(string $message): JsonResponse
    {
        return response()->json(['message' => $message], 404);
    }
}
