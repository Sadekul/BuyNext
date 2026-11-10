<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\InvoiceResource;
use App\Mail\InvoiceMail;
use App\Models\Invoice;
use App\Models\Order;
use App\Services\OrderDocuments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Throwable;

/** Invoices: record an order's payment, and list/read them across orders. */
class InvoiceController extends Controller
{
    private const WITH = ['admin', 'order.items', 'order.invoices', 'order.creditMemos'];

    /** POST /api/admin/v1/orders/{number}/invoices { note?, notify_customer? } → 201 */
    public function store(Request $request, string $number, OrderDocuments $documents): JsonResponse
    {
        $data = $request->validate([
            'note' => ['nullable', 'string', 'max:1000'],
            'notify_customer' => ['nullable', 'boolean'],
        ]);
        if (! Order::where('number', strtoupper($number))->exists()) {
            return response()->json(['message' => 'Order not found.'], 404);
        }
        $notify = $data['notify_customer'] ?? true;

        $invoice = DB::transaction(function () use ($number, $data, $notify, $request, $documents) {
            $order = Order::where('number', strtoupper($number))->lockForUpdate()->firstOrFail();

            return $documents->invoice($order, $request->user(), $data['note'] ?? null, $notify);
        });

        $invoice->load(self::WITH);
        if ($notify) {
            try {
                Mail::to($invoice->order->email)->send(new InvoiceMail($invoice));
            } catch (Throwable $e) {
                report($e); // the invoice is saved either way
            }
        }

        return (new InvoiceResource($invoice))->response()->setStatusCode(201);
    }

    /** GET /api/admin/v1/invoices?search&page&per_page - newest first; search: invoice number, order number, email. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $invoices = Invoice::with(self::WITH)
            ->when($data['search'] ?? null, function ($query, $search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $query->where(fn ($q) => $q->where('number', 'like', $like)
                    ->orWhereHas('order', fn ($o) => $o->where('number', 'like', $like)->orWhere('email', 'like', $like)));
            })
            ->latest('id')
            ->paginate($data['per_page'] ?? 20)
            ->withQueryString();

        return InvoiceResource::collection($invoices);
    }

    /** GET /api/admin/v1/invoices/{number} */
    public function show(string $number): InvoiceResource|JsonResponse
    {
        $invoice = Invoice::with(self::WITH)->where('number', strtoupper($number))->first();

        return $invoice ? new InvoiceResource($invoice) : response()->json(['message' => 'Invoice not found.'], 404);
    }
}
