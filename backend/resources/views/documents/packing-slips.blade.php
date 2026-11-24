{{--
    Phase 14: packing slips for the courier (one page per order). Tables only
    (dompdf: CSS 2.1). Bangla text (names, Bangla addresses) is drawn from
    Noto Sans Bengali, the rest from DejaVu Sans; nothing is loaded remotely.
--}}
<!DOCTYPE html>
<html lang="{{ $locale }}">
<head>
<meta charset="utf-8">
<title>Packing slips</title>
<style>
    @page { margin: 14mm 14mm; }
    @font-face { font-family: "Noto Sans Bengali"; font-style: normal; font-weight: normal; src: url("{{ resource_path('fonts/NotoSansBengali-Regular.ttf') }}") format("truetype"); }
    @font-face { font-family: "Noto Sans Bengali"; font-style: normal; font-weight: bold; src: url("{{ resource_path('fonts/NotoSansBengali-Bold.ttf') }}") format("truetype"); }
    * { font-family: "DejaVu Sans", "Noto Sans Bengali", sans-serif; }
    .bn, .bn * { font-family: "Noto Sans Bengali", "DejaVu Sans", sans-serif; }
    body { font-size: 10pt; color: #111827; margin: 0; }
    .slip { page-break-after: always; }
    .slip.last { page-break-after: auto; }
    table { width: 100%; border-collapse: collapse; }
    td, th { vertical-align: top; }
    .number { font-size: 26pt; font-weight: bold; letter-spacing: 1pt; }
    .muted { color: #52606d; }
    .label { font-size: 8pt; text-transform: uppercase; color: #52606d; letter-spacing: 0.5pt; }
    .box { border: 1.2pt solid #111827; padding: 8pt 10pt; margin-top: 10pt; }
    .recipient { font-size: 14pt; font-weight: bold; }
    .phone { font-size: 16pt; font-weight: bold; }
    .cod { font-size: 22pt; font-weight: bold; }
    .items th { text-align: left; font-size: 8.5pt; color: #52606d; border-bottom: 1.2pt solid #9aa5b1; padding: 4pt; }
    .items td { border-bottom: 0.6pt solid #d9e2ec; padding: 5pt 4pt; }
    .qty { text-align: right; width: 18%; font-size: 12pt; font-weight: bold; }
</style>
</head>
<body>
@foreach ($slips as $index => $slip)
<div class="slip{{ $loop->last ? ' last' : '' }}">
    <table>
        <tr>
            <td>
                <div class="label">{{ $store['name'] }} · Packing slip</div>
                <div class="number">{{ $slip['number'] }}</div>
                <div class="muted">{{ $slip['date'] }}@if ($slip['shipping_method']) · {{ $slip['shipping_method'] }}@endif</div>
            </td>
            <td style="text-align: right;">
                @if ($slip['zone'])
                    <div class="label">Delivery zone</div>
                    <div style="font-size: 13pt; font-weight: bold;" class="bn">{{ $slip['zone'] }}</div>
                @endif
                @if ($slip['eta'])<div class="muted">{{ $slip['eta'] }}</div>@endif
            </td>
        </tr>
    </table>

    <div class="box">
        <div class="label">Deliver to</div>
        <div class="recipient bn">{{ $slip['recipient'] }}</div>
        <div class="phone">{{ $slip['phone'] }}</div>
        <table style="margin-top: 6pt;">
            <tr>
                <td>@foreach ($slip['address_en'] as $line)<div class="bn">{{ $line }}</div>@endforeach</td>
                @if ($slip['address_bn'])
                    <td class="bn">@foreach ($slip['address_bn'] as $line)<div>{{ $line }}</div>@endforeach</td>
                @endif
            </tr>
        </table>
    </div>

    <div class="box">
        @if ($slip['cod'])
            <div class="label">Collect in cash (COD)</div>
            <div class="cod">{{ $slip['cod_amount'] }}</div>
            @if ($slip['advance_paid'])<div class="muted">Advance paid online: {{ $slip['advance_paid'] }}</div>@endif
        @else
            <div class="label">Payment</div>
            <div class="cod">PREPAID: collect nothing</div>
        @endif
    </div>

    <table class="items" style="margin-top: 12pt;">
        <thead><tr><th>Item</th><th>SKU</th><th class="qty">Qty</th></tr></thead>
        <tbody>
            @foreach ($slip['items'] as $item)
                <tr>
                    <td class="bn">{{ $item['name'] }}@if ($item['variant_label'])<br><span class="muted">{{ $item['variant_label'] }}</span>@endif</td>
                    <td>{{ $item['sku'] }}</td>
                    <td class="qty">{{ $item['quantity'] }}</td>
                </tr>
            @endforeach
        </tbody>
    </table>
    <p class="muted">{{ $slip['item_count'] }} {{ $slip['item_count'] === 1 ? 'item' : 'items' }}@if ($store['phone']) · {{ $store['name'] }}: {{ $store['phone'] }}@endif</p>
</div>
@endforeach
</body>
</html>
