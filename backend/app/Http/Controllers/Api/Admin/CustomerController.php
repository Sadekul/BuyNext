<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\PhoneNumber;
use App\Http\Resources\AdminCustomerResource;
use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\OneTimeCode;
use App\Models\Order;
use App\Services\AddressBook;
use App\Services\Audit;
use App\Services\OneTimeCodes;
use App\Services\Pricing;
use App\Services\TokenPairs;
use App\Support\Csv;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Customers, as shop staff manage them (Magento's Customers → All customers):
 * list and export, the full profile, edit, create (the customer sets their
 * own password from an emailed code), password reset email, block, delete.
 * Admins never see or set a customer's password.
 */
class CustomerController extends Controller
{
    public function __construct(private Audit $audit, private TokenPairs $tokens, private OneTimeCodes $codes) {}

    /**
     * GET /api/admin/v1/customers?search&status&verified&group_id&created_from&created_to&page&per_page
     * status: active | blocked | verified | unverified (verified/unverified kept from phase 1).
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $this->filters($request);
        $data += $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);

        $customers = $this->filtered($data)->with('group')->withCount('orders')
            ->latest('id')
            ->paginate($data['per_page'] ?? 20)
            ->withQueryString();

        return AdminCustomerResource::collection($customers);
    }

    /** GET /api/admin/v1/customers/export.csv - the list's filters, every matching customer. */
    public function export(Request $request): Response
    {
        $data = $this->filters($request);
        $customers = $this->filtered($data)->with('group')->withCount('orders')->latest('id')->get();
        $spent = $this->lifetimeSpentCents($customers->pluck('id')->all());

        return Csv::download('customers-'.now()->format('Y-m-d').'.csv',
            ['id', 'first_name', 'last_name', 'email', 'phone', 'group', 'status', 'email_verified', 'orders_count', 'lifetime_spent', 'last_login_at', 'created_at'],
            $customers->map(fn (Customer $c) => [
                $c->id, $c->first_name, $c->last_name, $c->email, $c->phone, $c->group?->name,
                ! $c->is_active ? 'blocked' : ($c->email_verified_at ? 'active' : 'unverified'),
                $c->email_verified_at ? 'yes' : 'no', $c->orders_count, Pricing::format($spent[$c->id] ?? 0),
                $c->last_login_at?->toIso8601ZuluString(), $c->created_at?->toIso8601ZuluString(),
            ]));
    }

    /** GET /api/admin/v1/customers/{id} - the full profile. */
    public function show(int $id): JsonResponse
    {
        $customer = Customer::with('group')->find($id);

        return $customer ? response()->json(['data' => $this->profile($customer)]) : $this->notFound();
    }

    /**
     * POST /api/admin/v1/customers { first_name, last_name, email, phone, group_id? } → 201
     * The account has no usable password: a "Set your password" email with a
     * reset code lets the customer choose one (and confirms the email).
     */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request, null);
        $customer = DB::transaction(function () use ($data, $request) {
            $customer = new Customer;
            $customer->fill([
                ...$data,
                'group_id' => $data['group_id'] ?? CustomerGroup::general()?->id,
                // Nobody knows this password, so nobody can sign in with it.
                'password' => Hash::make(Str::random(64)),
            ]);
            $customer->created_by_admin_id = $request->user()->id;
            $customer->save();
            $this->audit->record('customer.created', "Customer {$customer->email} created.", 'customer', $customer->id,
                Audit::created(Audit::fieldsOf($customer, ['first_name', 'last_name', 'email', 'phone', 'group_id'])));

            return $customer;
        });
        $this->codes->send($customer->email, OneTimeCode::RESET_PASSWORD, $customer->first_name, setPassword: true);

        return response()->json(['data' => $this->profile($customer->fresh('group'))], 201);
    }

    /**
     * PATCH /api/admin/v1/customers/{id} { first_name, last_name, email, phone, group_id, is_active } (any of them).
     * A new email is unverified and signs the customer out everywhere (their
     * next sign-in emails a code); blocking signs them out everywhere too.
     */
    public function update(Request $request, int $id): JsonResponse
    {
        $customer = Customer::find($id);
        if (! $customer) {
            return $this->notFound();
        }
        $data = $this->validated($request, $customer);

        DB::transaction(function () use ($customer, $data) {
            $fields = ['first_name', 'last_name', 'email', 'phone', 'group_id', 'is_active'];
            $before = Audit::fieldsOf($customer, $fields);
            $emailChanged = isset($data['email']) && $data['email'] !== $customer->email;
            $wasActive = $customer->is_active;

            $customer->fill(array_intersect_key($data, array_flip(['first_name', 'last_name', 'email', 'phone', 'group_id'])));
            if (array_key_exists('is_active', $data)) {
                $customer->is_active = (bool) $data['is_active'];
            }
            if ($emailChanged) {
                $customer->email_verified_at = null;
            }
            $customer->save();

            if ($emailChanged || ($wasActive && ! $customer->is_active)) {
                $this->tokens->revokeAll($customer);
            }
            $diff = Audit::diff($before, Audit::fieldsOf($customer, $fields));
            if ($diff) {
                // Blocking/unblocking alone keeps the phase 4 action names.
                $action = array_keys($diff['after']) === ['is_active']
                    ? ($customer->is_active ? 'customer.unblocked' : 'customer.blocked')
                    : 'customer.updated';
                $summary = match ($action) {
                    'customer.blocked' => "Customer {$customer->email} blocked.",
                    'customer.unblocked' => "Customer {$customer->email} unblocked.",
                    default => "Customer {$customer->email} updated: ".implode(', ', array_keys($diff['after'])).'.',
                };
                $this->audit->record($action, $summary, 'customer', $customer->id, $diff);
            }
        });

        return response()->json(['data' => $this->profile($customer->fresh('group'))]);
    }

    /** POST /api/admin/v1/customers/{id}/password-reset - emails the "set your password" code (like "Forgot password"). */
    public function passwordReset(int $id): JsonResponse
    {
        $customer = Customer::find($id);
        if (! $customer) {
            return $this->notFound();
        }
        if (! $customer->is_active) {
            throw ValidationException::withMessages(['customer' => 'This customer is blocked. Unblock the account before sending a password reset.']);
        }
        $wait = $this->codes->secondsUntilResend($customer->email, OneTimeCode::RESET_PASSWORD);
        if ($wait > 0) {
            return response()->json([
                'message' => "A code was sent to this customer less than a minute ago. Try again in {$wait} seconds.",
                'code' => 'too_soon',
            ], 429, ['Retry-After' => (string) $wait]);
        }
        $resendIn = $this->codes->send($customer->email, OneTimeCode::RESET_PASSWORD, $customer->first_name, setPassword: true);
        $this->audit->record('customer.password_reset_sent', "Password reset email sent to customer {$customer->email}.", 'customer', $customer->id);

        return response()->json([
            'message' => "We emailed {$customer->email} a code to set a new password.",
            'data' => ['email' => $customer->email, 'resend_in' => $resendIn],
        ]);
    }

    /**
     * DELETE /api/admin/v1/customers/{id} → 204. Deletes the account, its
     * addresses, notes, sign-ins and codes. Orders and reviews stay (for the
     * accounts) without the link. Refused while an order is still open.
     */
    public function destroy(int $id): Response|JsonResponse
    {
        $customer = Customer::find($id);
        if (! $customer) {
            return $this->notFound();
        }
        $open = $customer->orders()->whereIn('status', Order::OPEN_STATUSES)->count();
        if ($open > 0) {
            throw ValidationException::withMessages(['customer' => "This customer has {$open} open ".Str::plural('order', $open)
                .' (pending payment, processing, or shipped). Complete or cancel '.($open === 1 ? 'it' : 'them').' first.']);
        }

        DB::transaction(function () use ($customer) {
            $before = Audit::fieldsOf($customer, ['first_name', 'last_name', 'email', 'phone', 'group_id', 'is_active']);
            $this->tokens->revokeAll($customer);
            OneTimeCode::where('email', $customer->email)->delete();
            // Addresses and notes cascade; orders, reviews, coupon uses, and returns keep their rows with customer_id null.
            $customer->delete();
            $this->audit->record('customer.deleted', "Customer {$customer->email} deleted.", 'customer', $customer->id, Audit::deleted($before));
        });

        return response()->noContent();
    }

    /** The full profile for GET/POST/PATCH. */
    private function profile(Customer $customer): array
    {
        $recent = $customer->orders()->with('items')->latest('id')->limit(10)->get();

        return [
            ...(new AdminCustomerResource($customer))->resolve(),
            'addresses' => app(AddressBook::class)->list($customer),
            'orders_count' => $customer->orders()->count(),
            'lifetime_spent' => Pricing::format($this->lifetimeSpentCents([$customer->id])[$customer->id] ?? 0),
            'recent_orders' => $recent->map(fn (Order $order) => [
                'number' => $order->number,
                'status' => $order->status,
                'payment_status' => $order->payment_status,
                'source' => $order->source,
                'item_count' => $order->itemCount(),
                'total' => $order->grand_total,
                'placed_at' => $order->placed_at?->toIso8601ZuluString(),
            ])->values(),
            'reviews_count' => $customer->reviews()->count(),
            'notes' => $customer->notes()->with('admin')->get()->map->toApiArray()->values(),
        ];
    }

    /**
     * customer id => cents: non-cancelled orders' grand totals minus their credit memos.
     *
     * @param  list<int>  $ids
     */
    private function lifetimeSpentCents(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $orders = DB::table('orders')->whereIn('customer_id', $ids)->where('status', '!=', 'cancelled')
            ->groupBy('customer_id')->selectRaw('customer_id, SUM(grand_total) AS total')->pluck('total', 'customer_id');
        $refunds = DB::table('credit_memos')->join('orders', 'orders.id', '=', 'credit_memos.order_id')
            ->whereIn('orders.customer_id', $ids)->where('orders.status', '!=', 'cancelled')
            ->groupBy('orders.customer_id')->selectRaw('orders.customer_id AS customer_id, SUM(credit_memos.total) AS total')->pluck('total', 'customer_id');

        $spent = [];
        foreach ($ids as $id) {
            $spent[$id] = Pricing::toCents((string) ($orders[$id] ?? 0)) - Pricing::toCents((string) ($refunds[$id] ?? 0));
        }

        return $spent;
    }

    private function filters(Request $request): array
    {
        return $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', 'in:active,blocked,verified,unverified'],
            'verified' => ['nullable', 'boolean'],
            'group_id' => ['nullable', 'integer'],
            'created_from' => ['nullable', 'date_format:Y-m-d'],
            'created_to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:created_from'],
        ]);
    }

    private function filtered(array $data): Builder
    {
        return Customer::query()
            ->when($data['search'] ?? null, function ($query, $search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $query->where(fn ($q) => $q->where('first_name', 'like', $like)->orWhere('last_name', 'like', $like)
                    ->orWhere('email', 'like', $like)->orWhere('phone', 'like', $like)
                    ->orWhereRaw("concat(first_name, ' ', last_name) like ?", [$like]));
            })
            ->when($data['status'] ?? null, fn ($query, $status) => match ($status) {
                'active' => $query->where('is_active', true),
                'verified' => $query->whereNotNull('email_verified_at')->where('is_active', true),
                'unverified' => $query->whereNull('email_verified_at'),
                'blocked' => $query->where('is_active', false),
            })
            ->when(isset($data['verified']), fn ($query) => filter_var($data['verified'], FILTER_VALIDATE_BOOLEAN)
                ? $query->whereNotNull('email_verified_at') : $query->whereNull('email_verified_at'))
            ->when($data['group_id'] ?? null, fn ($query, $groupId) => $query->where('group_id', $groupId))
            ->when($data['created_from'] ?? null, fn ($query, $from) => $query->where('created_at', '>=', $from.' 00:00:00'))
            ->when($data['created_to'] ?? null, fn ($query, $to) => $query->where('created_at', '<=', $to.' 23:59:59'));
    }

    /** POST (all required but group_id) or PATCH (only what's sent). */
    private function validated(Request $request, ?Customer $customer): array
    {
        if (is_string($request->input('phone'))) {
            $request->merge(['phone' => PhoneNumber::normalize($request->input('phone'))]);
        }
        if (is_string($request->input('email'))) {
            $request->merge(['email' => OneTimeCodes::normalize($request->input('email'))]);
        }
        $required = $customer ? ['sometimes', 'required'] : ['required'];

        $data = $request->validate([
            'first_name' => [...$required, 'string', 'max:60'],
            'last_name' => [...$required, 'string', 'max:60'],
            'email' => [...$required, 'string', 'email', 'max:190', Rule::unique('customers', 'email')->ignore($customer?->id)],
            'phone' => [...$required, 'string', PhoneNumber::RULE],
            'group_id' => ['sometimes', 'nullable', 'integer', Rule::exists('customer_groups', 'id')],
            'is_active' => $customer ? ['sometimes', 'boolean'] : ['prohibited'],
        ], [
            'email.unique' => 'Another customer already uses this email.',
            'phone.regex' => 'Enter the phone number with its country code, for example +1 555 010 0100.',
            'group_id.exists' => 'Choose a customer group.',
        ]);
        if (array_key_exists('group_id', $data) && $data['group_id'] === null) {
            unset($data['group_id']); // "no group" = keep the current one (a customer always has a group)
        }

        return array_map(fn ($value) => is_string($value) ? trim($value) : $value, $data);
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Customer not found.'], 404);
    }
}
