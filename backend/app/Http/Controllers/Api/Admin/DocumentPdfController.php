<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\CreditMemo;
use App\Models\Invoice;
use App\Services\DocumentPdfs;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

/** Phase 10 (part A): "Download PDF" for invoices and credit memos in the admin (orders.view). */
class DocumentPdfController extends Controller
{
    public function __construct(private DocumentPdfs $pdfs) {}

    /** GET /api/admin/v1/invoices/{number}.pdf */
    public function invoice(string $number): Response|JsonResponse
    {
        $invoice = Invoice::where('number', strtoupper(trim($number)))->first();

        return $invoice ? $this->pdfs->download($invoice) : response()->json(['message' => 'Invoice not found.'], 404);
    }

    /** GET /api/admin/v1/credit-memos/{number}.pdf */
    public function creditMemo(string $number): Response|JsonResponse
    {
        $memo = CreditMemo::where('number', strtoupper(trim($number)))->first();

        return $memo ? $this->pdfs->download($memo) : response()->json(['message' => 'Credit memo not found.'], 404);
    }
}
