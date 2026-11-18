<?php

namespace App\Services;

use App\Http\Resources\OrderResource;
use App\Models\CreditMemo;
use App\Models\Invoice;
use App\Models\Order;
use Barryvdh\DomPDF\PDF;
use Illuminate\Http\Response;

/**
 * Phase 10 (part A): invoices and credit memos as PDF files.
 *
 * Made on the server with dompdf (through barryvdh/laravel-dompdf) from the
 * Blade views resources/views/documents/{invoice,credit-memo}.blade.php.
 * Nothing is fetched from the network (remote resources off, no images),
 * PHP and JavaScript in the HTML are off, and the font is DejaVu Sans (ships
 * with dompdf, covers accents, Cyrillic, Greek, and most symbols).
 *
 * The item lines and totals come from OrderResource::itemsOf()/totalsOf(),
 * like the storefront's printable invoice, so whatever those gain (gift card
 * amounts, part B) reaches the PDF too. html() is what tests read.
 */
class DocumentPdfs
{
    public const PAPER_SIZES = ['a4', 'letter'];

    /** Relations a document needs (loaded if missing). */
    private const INVOICE_RELATIONS = ['order.items', 'order.invoices', 'order.creditMemos'];

    private const MEMO_RELATIONS = ['order.items', 'order.invoices', 'order.creditMemos', 'items.orderItem', 'orderReturn'];

    public function __construct(private Settings $settings) {}

    /** "12.5" → "$12.50", "-5" → "−$5.00", null → "—" (the API's money strings, as a person reads them). */
    public static function money(string|int|float|null $amount): string
    {
        if ($amount === null || $amount === '' || ! is_numeric($amount)) {
            return '—';
        }
        $cents = Pricing::toCents((string) $amount);

        return ($cents < 0 ? '−' : '').'$'.number_format(abs($cents) / 100, 2);
    }

    /** Is this money string above zero? */
    public static function positive(string|int|float|null $amount): bool
    {
        return is_numeric($amount) && Pricing::toCents((string) $amount) > 0;
    }

    public static function filename(Invoice|CreditMemo $document): string
    {
        return $document->number.'.pdf';
    }

    /** The document as HTML (what dompdf draws). */
    public function html(Invoice|CreditMemo $document): string
    {
        return $document instanceof Invoice
            ? view('documents.invoice', $this->invoiceData($document))->render()
            : view('documents.credit-memo', $this->creditMemoData($document))->render();
    }

    /** The PDF file's bytes. */
    public function pdf(Invoice|CreditMemo $document): string
    {
        $paper = $this->settings->get('paper_size', 'a4');

        /** @var PDF $pdf a new wrapper each time (the container binds it, not a singleton) */
        $pdf = app('dompdf.wrapper');

        return $pdf->setOption([
            'isRemoteEnabled' => false,
            'isPhpEnabled' => false,
            'isJavascriptEnabled' => false,
            'defaultFont' => 'DejaVu Sans',
            'isFontSubsettingEnabled' => true, // only the letters used: ~40 KB instead of ~800 KB
        ])->setPaper(in_array($paper, self::PAPER_SIZES, true) ? $paper : 'a4')
            ->loadHTML($this->html($document))
            ->output();
    }

    /** The download answer: application/pdf, attachment; filename="INV-100001.pdf", not cached. */
    public function download(Invoice|CreditMemo $document): Response
    {
        return response($this->pdf($document), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="'.self::filename($document).'"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /** What the invoice view shows. */
    public function invoiceData(Invoice $invoice): array
    {
        $invoice->loadMissing(self::INVOICE_RELATIONS);
        $order = $invoice->order;

        return [
            ...$this->common($order),
            'invoice' => [
                'number' => $invoice->number,
                'date' => $invoice->created_at?->format('M j, Y'),
                'amount' => $invoice->amount,
                // Like the customer's invoice page: a note only if the customer was told.
                'note' => $invoice->customer_notified ? $invoice->note : null,
            ],
            'credit_memos' => $order->creditMemos->sortBy('id')->map(fn (CreditMemo $memo) => [
                'number' => $memo->number,
                'date' => $memo->created_at?->format('M j, Y'),
                'total' => $memo->total,
                'refund_reference' => $memo->refund_reference,
            ])->values()->all(),
        ];
    }

    /** What the credit memo view shows. */
    public function creditMemoData(CreditMemo $memo): array
    {
        $memo->loadMissing(self::MEMO_RELATIONS);
        $order = $memo->order;
        $fields = $memo->getAttributes();

        return [
            ...$this->common($order),
            'memo' => [
                'number' => $memo->number,
                'date' => $memo->created_at?->format('M j, Y'),
                'return_number' => $memo->return_id ? $memo->orderReturn?->number : null,
                'items' => $memo->items->map(fn ($item) => [
                    'name' => $item->orderItem?->name,
                    'variant_label' => $item->orderItem?->variant_label,
                    'sku' => $item->orderItem?->sku,
                    'quantity' => $item->quantity,
                    'amount' => $item->amount,
                ])->values()->all(),
                'subtotal' => $memo->subtotal,
                'shipping_refund' => $memo->shipping_refund,
                'adjustment' => $memo->adjustment,
                'total' => $memo->total,
                // Part B (gift cards): the part returned to a gift card, if credit memos record it.
                'gift_card_refund' => $fields['gift_card_refund'] ?? null,
                'other_refund' => Pricing::format(Pricing::toCents((string) $memo->total) - Pricing::toCents((string) ($fields['gift_card_refund'] ?? 0))),
                'refund_reference' => $memo->refund_reference,
                'restocked' => (bool) $memo->restocked,
                'note' => $memo->customer_notified ? $memo->note : null,
            ],
        ];
    }

    /** The store, the order, its addresses, lines, and totals (both documents). */
    private function common(Order $order): array
    {
        $methods = [...config('buynest.store.payment_methods', []), ...config('buynest.store.admin_payment_methods', [])];

        return [
            'store' => [
                'name' => $this->settings->get('store_name'),
                'address' => $this->settings->get('address'),
                'email' => $this->settings->get('support_email'),
                'phone' => $this->settings->get('support_phone'),
            ],
            'order' => [
                'number' => $order->number,
                'date' => $order->placed_at?->format('M j, Y'),
                'email' => $order->email,
                'payment_method' => $methods[$order->payment_method] ?? ucfirst(str_replace('_', ' ', (string) $order->payment_method)),
                'payment_provider' => $order->payment_provider ? ucfirst((string) $order->payment_provider) : null,
                'payment_status' => ucfirst(str_replace('_', ' ', (string) $order->payment_status)),
                'shipping_method' => $order->shipping_label,
                'coupon_code' => $order->coupon_code,
                'applied_rules' => $order->applied_rules ?? [],
                'billing_address' => $order->billing_address,
                'shipping_address' => $order->shipping_address,
            ],
            'items' => OrderResource::itemsOf($order),
            'totals' => OrderResource::totalsOf($order),
        ];
    }
}
