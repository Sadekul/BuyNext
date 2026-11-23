<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\Invoice;
use App\Models\Order;
use App\Services\DocumentPdfs;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/** Phase 10 (part A): the storefront's "Download PDF" for an invoice. */
class InvoicePdfController extends Controller
{
    /**
     * GET /api/v1/orders/{number}/invoices/{invoice}.pdf (guest: X-Order-Email header, or ?email=) → the PDF (attachment).
     * Who may: the signed-in customer who owns the order (Bearer token), or
     * anyone sending the order's email (the guest lookup's proof, like Pay now
     * and Cancel). Otherwise the lookup's 404, so nothing tells whether the
     * order exists.
     */
    public function __invoke(Request $request, string $number, string $invoice, DocumentPdfs $pdfs): Response|JsonResponse
    {
        // The guest's email may come in the X-Order-Email header (preferred: the store's sign-in service
        // sends it there so it stays out of server logs and browser history) or, as before, in ?email=.
        if ($request->hasHeader('X-Order-Email')) {
            $request->merge(['email' => (string) $request->header('X-Order-Email')]);
        }
        $data = $request->validate(['email' => ['nullable', 'string', 'email', 'max:190']]);
        $customer = $request->user() instanceof Customer ? $request->user() : null;

        $order = Order::where('number', strtoupper(trim($number)))->first();
        $owner = $order && $customer && $order->customer_id === $customer->id;
        $emailMatches = $order && filled($data['email'] ?? null) && mb_strtolower($order->email) === mb_strtolower(trim($data['email']));
        if (! $owner && ! $emailMatches) {
            return response()->json(['message' => __('We couldn\'t find an order with that number and email.')], 404);
        }

        $found = Invoice::where('order_id', $order->id)->where('number', strtoupper(trim($invoice)))->first();

        return $found ? $pdfs->download($found->setRelation('order', $order)) : response()->json(['message' => __('Invoice not found.')], 404);
    }
}
