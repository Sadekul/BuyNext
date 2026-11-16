<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\ReturnResource;
use App\Models\Order;
use App\Models\OrderReturn;
use App\Services\Returns;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/** Returns (RMA) in the admin: list, detail, status changes, and creating one for a customer. */
class ReturnController extends Controller
{
    private const WITH = ['order', 'customer', 'createdBy', 'items.orderItem', 'creditMemo'];

    public function __construct(private Returns $returns) {}

    /** GET /api/admin/v1/returns?status&search&page&per_page - newest first; search: RMA number, order number, email, customer name. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'status' => ['nullable', Rule::in(OrderReturn::STATUSES)],
            'search' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $returns = OrderReturn::with(self::WITH)
            ->when($data['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
            ->when($data['search'] ?? null, function ($query, $search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $query->where(fn ($q) => $q->where('number', 'like', $like)
                    ->orWhereHas('order', fn ($o) => $o->where('number', 'like', $like)->orWhere('email', 'like', $like))
                    ->orWhereHas('customer', fn ($c) => $c->whereRaw("concat(first_name, ' ', last_name) like ?", [$like])));
            })
            ->latest('id')
            ->paginate($data['per_page'] ?? 20)
            ->withQueryString();

        return ReturnResource::collection($returns)->additional(['meta' => [
            'counts' => collect(OrderReturn::STATUSES)->mapWithKeys(fn ($status) => [$status => 0])
                ->merge(OrderReturn::groupBy('status')->selectRaw('status, count(*) as total')->pluck('total', 'status')->map(fn ($n) => (int) $n)),
        ]]);
    }

    /** GET /api/admin/v1/returns/{number} */
    public function show(string $number): JsonResponse
    {
        $return = $this->find($number);

        return $return ? response()->json(['data' => (new ReturnResource($return))->detail()->resolve()]) : $this->notFound();
    }

    /**
     * PATCH /api/admin/v1/returns/{number} { status, admin_note?, resolution?, notify_customer?,
     *   items?: [{ return_item_id, condition }], restock? } (items/restock with "received").
     */
    public function update(Request $request, string $number): JsonResponse
    {
        $return = $this->find($number);
        if (! $return) {
            return $this->notFound();
        }
        $data = $request->validate([
            'status' => ['required', Rule::in(OrderReturn::STATUSES)],
            'admin_note' => ['nullable', 'string', 'max:1000'],
            'resolution' => ['nullable', Rule::in(OrderReturn::RESOLUTIONS)],
            'notify_customer' => ['nullable', 'boolean'],
            'items' => ['nullable', 'array', 'max:50'],
            'items.*.return_item_id' => ['required', 'integer', 'distinct'],
            'items.*.condition' => ['required', Rule::in(OrderReturn::CONDITIONS)],
            'restock' => ['nullable', 'boolean'],
        ], [
            'status.in' => 'Choose a valid return status.',
            'resolution.in' => 'Choose refund or replace.',
            'items.*.condition.in' => 'Choose unopened, opened, or damaged.',
        ]);

        $this->returns->changeStatus($return, $request->user(), $data, (bool) ($data['notify_customer'] ?? true));

        return response()->json(['data' => (new ReturnResource($this->find($number)))->detail()->resolve()]);
    }

    /**
     * POST /api/admin/v1/orders/{number}/returns { items, reason, comment?, override_window?, notify_customer? } → 201
     * Same rules as the customer's request, except staff may override the window.
     */
    public function store(Request $request, string $number): JsonResponse
    {
        $order = Order::where('number', strtoupper($number))->first();
        if (! $order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }
        $data = $request->validate([
            ...self::requestRules(),
            'override_window' => ['nullable', 'boolean'],
            'notify_customer' => ['nullable', 'boolean'],
        ], self::requestMessages());

        $return = $this->returns->create($order, $data, $request->user(),
            overrideWindow: (bool) ($data['override_window'] ?? false), notify: (bool) ($data['notify_customer'] ?? true));

        return response()->json(['data' => (new ReturnResource($this->find($return->number)))->detail()->resolve()], 201);
    }

    /** The body of a return request (shared with the storefront). */
    public static function requestRules(): array
    {
        return [
            'items' => ['required', 'array', 'min:1', 'max:50'],
            'items.*.order_item_id' => ['required', 'integer'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:999'],
            'reason' => ['required', 'string', 'max:60'],
            'comment' => ['nullable', 'string', 'max:1000'],
        ];
    }

    public static function requestMessages(): array
    {
        return [
            'items.required' => 'Choose at least one item to return.',
            'items.min' => 'Choose at least one item to return.',
            'items.*.quantity.min' => 'The quantity must be at least 1.',
            'reason.required' => 'Choose a reason for the return.',
        ];
    }

    private function find(string $number): ?OrderReturn
    {
        return OrderReturn::with(self::WITH)->where('number', strtoupper($number))->first();
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Return not found.'], 404);
    }
}
