<?php

namespace App\Services;

use App\Http\Resources\OrderResource;
use App\Models\CreditMemo;
use App\Models\Invoice;
use App\Models\Order;
use App\Services\Payments\SslCommerzPayments;
use App\Support\Currency;
use App\Support\Locale;
use Barryvdh\DomPDF\PDF;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Traits\Localizable;

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
 *
 * Phase 13: a document is in the order's language (Locale::forOrder: the
 * customer's saved language, else the language the order was placed in),
 * also when staff download it. Bangla documents put Noto Sans Bengali first
 * in the font list and write money, counts and dates with Bangla digits
 * (store setting bangla_digits). dompdf has no complex-script shaping, so
 * some conjuncts and vowel signs are drawn from their parts; the text stays
 * readable and copyable.
 */
class DocumentPdfs
{
    use Localizable;

    public const PAPER_SIZES = ['a4', 'letter'];

    /** Relations a document needs (loaded if missing). */
    private const INVOICE_RELATIONS = ['order.items', 'order.invoices', 'order.creditMemos'];

    private const MEMO_RELATIONS = ['order.items', 'order.invoices', 'order.creditMemos', 'items.orderItem', 'orderReturn'];

    public function __construct(private Settings $settings) {}

    /**
     * "12.5" → "$12.50", "-5" → "−$5.00", null → "—" (the API's money strings, as a person reads them).
     * Phase 12: in $currency (the order's: "৳1,250.00"); the store currency when null.
     * Phase 13: $locale "bn" writes Bangla digits (setting); null = English.
     */
    public static function money(string|int|float|null $amount, ?string $currency = null, ?string $locale = null): string
    {
        if ($amount === null || $amount === '' || ! is_numeric($amount)) {
            return '—';
        }
        $cents = Pricing::toCents((string) $amount);

        return ($cents < 0 ? '−' : '').Currency::formatCents(abs($cents), $currency, $locale);
    }

    /** Phase 13: a document date: "Nov 19, 2026" in English (as before), "১৯ নভেম্বর ২০২৬" in Bangla. */
    public static function date(?\DateTimeInterface $date): ?string
    {
        if ($date === null) {
            return null;
        }

        return Locale::isBangla() ? Locale::date($date) : $date->format('M j, Y');
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
        return $this->withLocale(Locale::forOrder($document->order), fn () => $document instanceof Invoice
            ? view('documents.invoice', $this->invoiceData($document))->render()
            : view('documents.credit-memo', $this->creditMemoData($document))->render());
    }

    /** The PDF file's bytes. */
    public function pdf(Invoice|CreditMemo $document): string
    {
        $paper = $this->settings->get('paper_size', 'a4');

        /** @var PDF $pdf a new wrapper each time (the container binds it, not a singleton) */
        $pdf = app('dompdf.wrapper');
        // Phase 12: the font for the taka sign (resources/fonts) is registered from the local disk; dompdf keeps its metrics here.
        $fontCache = storage_path('framework/cache/dompdf-fonts');
        File::ensureDirectoryExists($fontCache);

        return $pdf->setOption([
            'fontDir' => $fontCache,
            'fontCache' => $fontCache,
            'chroot' => [base_path()],
            'isRemoteEnabled' => false,
            'isPhpEnabled' => false,
            'isJavascriptEnabled' => false,
            'defaultFont' => 'DejaVu Sans',
            'isFontSubsettingEnabled' => true, // only the letters used: ~40 KB instead of ~800 KB
        ])->setPaper(in_array($paper, self::PAPER_SIZES, true) ? $paper : 'a4')
            ->loadHTML(self::visualBangla($this->html($document)))
            ->output();
    }

    /**
     * Phase 13: dompdf draws letters in the order they are stored and has no
     * Bangla shaping, so a vowel sign written before its consonant (ি ে ৈ)
     * would be drawn after it ("তারখি" for তারিখ). For the PDF only, those
     * signs are moved before their consonant cluster, and the two-part signs
     * ো ৌ are split around it (ে…া, ে…ৗ). Conjuncts still show a hasanta
     * (ন্ট), a dompdf limit. Text outside tags only; html() stays logical.
     */
    public static function visualBangla(string $html): string
    {
        if (! preg_match('/[\x{0980}-\x{09FF}]/u', $html)) {
            return $html;
        }
        $cluster = '((?:[\x{0995}-\x{09B9}\x{09CE}\x{09DC}-\x{09DF}]\x{09BC}?\x{09CD})*[\x{0995}-\x{09B9}\x{09CE}\x{09DC}-\x{09DF}]\x{09BC}?)';

        return preg_replace_callback('/>([^<]+)</u', fn (array $m) => '>'.preg_replace(
            ["/{$cluster}([\x{09BF}\x{09C7}\x{09C8}])/u", "/{$cluster}\x{09CB}/u", "/{$cluster}\x{09CC}/u"],
            ['$2$1', "\u{09C7}\$1\u{09BE}", "\u{09C7}\$1\u{09D7}"],
            $m[1],
        ).'<', $html);
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
                'date' => self::date($invoice->created_at),
                'amount' => $invoice->amount,
                // Like the customer's invoice page: a note only if the customer was told.
                'note' => $invoice->customer_notified ? $invoice->note : null,
            ],
            'credit_memos' => $order->creditMemos->sortBy('id')->map(fn (CreditMemo $memo) => [
                'number' => $memo->number,
                'date' => self::date($memo->created_at),
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
                'date' => self::date($memo->created_at),
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
            'currency' => $order->currencyCode(), // phase 12: every amount of the document is in it
            'locale' => Locale::current(), // phase 13: the document's language (the order's)
            'store' => [
                'name' => $this->settings->get('store_name'),
                'address' => $this->settings->get('address'),
                'email' => $this->settings->get('support_email'),
                'phone' => $this->settings->get('support_phone'),
            ],
            'order' => [
                'number' => $order->number,
                'date' => self::date($order->placed_at),
                'email' => $order->email,
                'payment_method' => __($methods[$order->payment_method] ?? ucfirst(str_replace('_', ' ', (string) $order->payment_method))),
                'payment_provider' => match ($order->payment_provider) {
                    null, '' => null,
                    'paypal' => 'PayPal',
                    'sslcommerz' => SslCommerzPayments::methodLabel($order) ?? 'SSLCommerz', // phase 12: "bKash", "Visa card", ...
                    default => ucfirst(str_replace('_', ' ', (string) $order->payment_provider)),
                },
                'payment_status' => __(ucfirst(str_replace('_', ' ', (string) $order->payment_status))),
                'shipping_method' => $order->shipping_label ? __($order->shipping_label) : $order->shipping_label,
                'coupon_code' => $order->coupon_code,
                'applied_rules' => $order->applied_rules ?? [],
                'billing_address' => $order->billing_address,
                'shipping_address' => $order->shipping_address,
                'reward_points' => OrderResource::rewardPointsOf($order), // phase 11
            ],
            'items' => OrderResource::itemsOf($order),
            'totals' => OrderResource::totalsOf($order),
        ];
    }
}
