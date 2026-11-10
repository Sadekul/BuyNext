<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminCustomerResource;
use App\Models\Customer;
use App\Services\TokenPairs;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/** Customers, as shop staff manage them (like Magento's Customers > All Customers). */
class CustomerController extends Controller
{
    /** GET /api/admin/v1/customers?search&status=verified|unverified|blocked&page&per_page */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', 'in:verified,unverified,blocked'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $customers = Customer::query()
            ->when($data['search'] ?? null, function ($query, $search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $query->where(fn ($q) => $q->where('first_name', 'like', $like)->orWhere('last_name', 'like', $like)
                    ->orWhere('email', 'like', $like)->orWhere('phone', 'like', $like)
                    ->orWhereRaw("concat(first_name, ' ', last_name) like ?", [$like]));
            })
            ->when($data['status'] ?? null, fn ($query, $status) => match ($status) {
                'verified' => $query->whereNotNull('email_verified_at')->where('is_active', true),
                'unverified' => $query->whereNull('email_verified_at'),
                'blocked' => $query->where('is_active', false),
            })
            ->latest('id')
            ->paginate($data['per_page'] ?? 20)
            ->withQueryString();

        return AdminCustomerResource::collection($customers);
    }

    /** GET /api/admin/v1/customers/{customer} */
    public function show(Customer $customer): AdminCustomerResource
    {
        return new AdminCustomerResource($customer);
    }

    /** PATCH /api/admin/v1/customers/{customer} { is_active } - block or unblock. Blocking signs them out everywhere. */
    public function update(Request $request, Customer $customer, TokenPairs $tokens): AdminCustomerResource
    {
        $data = $request->validate(['is_active' => ['required', 'boolean']]);
        $customer->forceFill(['is_active' => $data['is_active']])->save();
        if (! $customer->is_active) {
            $tokens->revokeAll($customer);
        }

        return new AdminCustomerResource($customer);
    }
}
