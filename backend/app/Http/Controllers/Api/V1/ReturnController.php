<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Api\Admin\ReturnController as AdminReturnController;
use App\Http\Controllers\Controller;
use App\Http\Resources\CustomerReturnResource;
use App\Models\Order;
use App\Models\OrderReturn;
use App\Services\Returns;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/** The signed-in customer's returns: request one for their own order, list, detail. Anyone else's is "not found". */
class ReturnController extends Controller
{
    private const WITH = ['order', 'items.orderItem', 'creditMemo'];

    /** POST /api/v1/orders/{number}/returns { items: [{ order_item_id, quantity }], reason, comment? } → 201 */
    public function store(Request $request, string $number, Returns $returns): JsonResponse
    {
        $order = Order::where('number', strtoupper($number))->where('customer_id', $request->user()->id)->first();
        if (! $order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }
        $data = $request->validate(AdminReturnController::requestRules(), AdminReturnController::requestMessages());
        $return = $returns->create($order, $data);

        return response()->json(['data' => $this->resource($return->number, $request)], 201);
    }

    /** GET /api/v1/returns - newest first. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:50']]);
        $returns = OrderReturn::with(self::WITH)->where('customer_id', $request->user()->id)
            ->latest('id')->paginate($data['per_page'] ?? 10)->withQueryString();

        return CustomerReturnResource::collection($returns);
    }

    /** GET /api/v1/returns/{number} */
    public function show(Request $request, string $number): JsonResponse
    {
        $data = $this->resource($number, $request);

        return $data ? response()->json(['data' => $data]) : response()->json(['message' => 'Return not found.'], 404);
    }

    private function resource(string $number, Request $request): ?array
    {
        $return = OrderReturn::with(self::WITH)->where('number', strtoupper($number))->where('customer_id', $request->user()->id)->first();

        return $return ? (new CustomerReturnResource($return))->detail()->resolve() : null;
    }
}
