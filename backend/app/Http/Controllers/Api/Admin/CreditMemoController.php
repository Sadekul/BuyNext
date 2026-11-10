<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\CreditMemoResource;
use App\Mail\RefundMail;
use App\Models\CreditMemo;
use App\Models\Order;
use App\Services\Refunds;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Throwable;

/** Refunds (credit memos): the limits for the form, creating one, and listing them. */
class CreditMemoController extends Controller
{
    private const WITH = ['order', 'admin', 'items.orderItem'];

    // Money with at most 2 decimals; the adjustment may be negative (a fee kept).
    private const MONEY = 'regex:/^\d{1,7}(\.\d{1,2})?$/';

    private const SIGNED_MONEY = 'regex:/^-?\d{1,7}(\.\d{1,2})?$/';

    /** GET /api/admin/v1/orders/{number}/refundable → { items, shipping_refundable, max_total } */
    public function refundable(string $number, Refunds $refunds): JsonResponse
    {
        $order = Order::where('number', strtoupper($number))->with(['items', 'invoices', 'creditMemos.items'])->first();

        return $order
            ? response()->json(['data' => $refunds->refundable($order)])
            : response()->json(['message' => 'Order not found.'], 404);
    }

    /**
     * POST /api/admin/v1/orders/{number}/credit-memos
     * { items: [{ order_item_id, quantity }], shipping_refund, adjustment, restock, note?, notify_customer? } → 201
     */
    public function store(Request $request, string $number, Refunds $refunds): JsonResponse
    {
        $data = $request->validate([
            'items' => ['nullable', 'array', 'max:50'],
            'items.*.order_item_id' => ['required', 'integer'],
            'items.*.quantity' => ['required', 'integer', 'min:0', 'max:999'],
            'shipping_refund' => ['nullable', self::MONEY],
            'adjustment' => ['nullable', self::SIGNED_MONEY],
            'restock' => ['nullable', 'boolean'],
            'note' => ['nullable', 'string', 'max:1000'],
            'notify_customer' => ['nullable', 'boolean'],
        ], [
            'items.*.quantity.min' => 'The quantity can\'t be negative.',
            'shipping_refund.regex' => 'Enter the shipping refund as an amount, for example 4.99.',
            'adjustment.regex' => 'Enter the adjustment as an amount, for example 5.00 or -5.00.',
        ]);
        if (! Order::where('number', strtoupper($number))->exists()) {
            return response()->json(['message' => 'Order not found.'], 404);
        }
        $notify = $data['notify_customer'] ?? true;

        $memo = DB::transaction(function () use ($number, $data, $notify, $request, $refunds) {
            $order = Order::where('number', strtoupper($number))->lockForUpdate()->firstOrFail();

            return $refunds->refund($order, $request->user(), $data, $notify);
        });

        $memo->load(self::WITH);
        if ($notify) {
            try {
                Mail::to($memo->order->email)->send(new RefundMail($memo));
            } catch (Throwable $e) {
                report($e);
            }
        }

        return (new CreditMemoResource($memo))->response()->setStatusCode(201);
    }

    /** GET /api/admin/v1/credit-memos?search&page&per_page - newest first; search: memo number, order number, email. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $memos = CreditMemo::with(self::WITH)
            ->when($data['search'] ?? null, function ($query, $search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $query->where(fn ($q) => $q->where('number', 'like', $like)
                    ->orWhereHas('order', fn ($o) => $o->where('number', 'like', $like)->orWhere('email', 'like', $like)));
            })
            ->latest('id')
            ->paginate($data['per_page'] ?? 20)
            ->withQueryString();

        return CreditMemoResource::collection($memos);
    }

    /** GET /api/admin/v1/credit-memos/{number} */
    public function show(string $number): CreditMemoResource|JsonResponse
    {
        $memo = CreditMemo::with(self::WITH)->where('number', strtoupper($number))->first();

        return $memo ? new CreditMemoResource($memo) : response()->json(['message' => 'Credit memo not found.'], 404);
    }
}
