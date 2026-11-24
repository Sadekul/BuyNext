<?php

namespace App\Services;

use App\Models\Order;
use Barryvdh\DomPDF\PDF;
use Illuminate\Http\Response;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\File;

/**
 * Phase 14: packing slips for the courier, as PDF (dompdf, like the invoices
 * in DocumentPdfs): a page per order with the order number in big type, the
 * recipient and mobile, the full address (also in Bangla when the order was
 * placed in Bangla), items and quantities (no prices), the cash to collect in
 * large type, the delivery zone and the delivery time. html() is what tests read.
 */
class PackingSlips
{
    public function __construct(private Settings $settings) {}

    /** What the view shows for one order. */
    public function slip(Order $order): array
    {
        $order->loadMissing(['items', 'deliveryZone']);
        $address = $order->shipping_address ?? [];
        $english = BdAddresses::lines($address, 'en') ?? array_values(array_filter([
            $address['line1'] ?? null, $address['line2'] ?? null,
            trim(($address['city'] ?? '').(filled($address['state'] ?? null) ? ', '.$address['state'] : '').' '.($address['postal_code'] ?? '')),
            $address['country'] ?? null,
        ]));
        $bangla = ($order->locale ?? 'en') === 'bn' ? BdAddresses::lines($address, 'bn') : null;

        return [
            'number' => $order->number,
            'date' => $order->placed_at?->format('M j, Y'),
            'recipient' => trim(($address['first_name'] ?? '').' '.($address['last_name'] ?? '')),
            'phone' => $order->phone,
            'address_en' => $english,
            'address_bn' => $bangla,
            'zone' => $order->deliveryZone ? $order->deliveryZone->name.' / '.$order->deliveryZone->bn_name : null,
            'eta' => ShippingRates::etaText($order->delivery_eta_min, $order->delivery_eta_max, 'en'),
            'shipping_method' => $order->shipping_label,
            'cod' => $order->isCod(),
            'cod_amount' => DocumentPdfs::money(Pricing::format($order->codDueCents()), $order->currencyCode()),
            'advance_paid' => Pricing::toCents($order->advance_paid ?? 0) > 0 ? DocumentPdfs::money($order->advance_paid, $order->currencyCode()) : null,
            'confirmation_status' => $order->confirmation_status,
            'items' => $order->items->map(fn ($item) => [
                'sku' => $item->sku, 'name' => $item->name, 'variant_label' => $item->variant_label, 'quantity' => $item->quantity,
            ])->values()->all(),
            'item_count' => $order->itemCount(),
        ];
    }

    public function html(Collection $orders): string
    {
        return view('documents.packing-slips', [
            'store' => ['name' => $this->settings->get('store_name'), 'phone' => $this->settings->get('support_phone')],
            'slips' => $orders->map(fn (Order $order) => $this->slip($order))->all(),
            'locale' => 'en',
        ])->render();
    }

    public function pdf(Collection $orders): string
    {
        /** @var PDF $pdf */
        $pdf = app('dompdf.wrapper');
        $fontCache = storage_path('framework/cache/dompdf-fonts');
        File::ensureDirectoryExists($fontCache);
        $paper = $this->settings->get('paper_size', 'a4');

        return $pdf->setOption([
            'fontDir' => $fontCache,
            'fontCache' => $fontCache,
            'chroot' => [base_path()],
            'isRemoteEnabled' => false,
            'isPhpEnabled' => false,
            'isJavascriptEnabled' => false,
            'defaultFont' => 'DejaVu Sans',
            'isFontSubsettingEnabled' => true,
        ])->setPaper(in_array($paper, DocumentPdfs::PAPER_SIZES, true) ? $paper : 'a4')
            ->loadHTML(DocumentPdfs::visualBangla($this->html($orders)))
            ->output();
    }

    public function download(Collection $orders, string $filename): Response
    {
        return response($this->pdf($orders), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
