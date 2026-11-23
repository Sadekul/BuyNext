{{--
    Phase 10 (part A): the frame of the PDF documents (invoice, credit memo).
    dompdf understands CSS 2.1 and tables, not flexbox or grid, so the layout
    is tables. No images or web fonts: nothing is loaded from anywhere
    (remote resources are off); DejaVu Sans ships with dompdf.
    Phase 12: DejaVu Sans has no taka sign (৳, U+09F3), so Noto Sans Bengali
    (resources/fonts, OFL) follows it in the font list: dompdf takes each
    character from the first font that has it. Loaded from the local disk.
--}}
<!DOCTYPE html>
<html lang="{{ $locale ?? 'en' }}">
<head>
<meta charset="utf-8">
<title>@yield('title')</title>
<style>
    @page { margin: 18mm 16mm; }
    @font-face { font-family: "Noto Sans Bengali"; font-style: normal; font-weight: normal; src: url("{{ resource_path('fonts/NotoSansBengali-Regular.ttf') }}") format("truetype"); }
    @font-face { font-family: "Noto Sans Bengali"; font-style: normal; font-weight: bold; src: url("{{ resource_path('fonts/NotoSansBengali-Bold.ttf') }}") format("truetype"); }
    {{-- Phase 13: Bangla documents take Bangla letters (and the conjuncts dompdf can draw) from Noto Sans Bengali first. --}}
    @if (($locale ?? 'en') === 'bn')
    * { font-family: "Noto Sans Bengali", "DejaVu Sans", sans-serif; }
    @else
    * { font-family: "DejaVu Sans", "Noto Sans Bengali", sans-serif; }
    @endif
    body { font-size: 9.5pt; color: #1f2933; line-height: 1.4; margin: 0; }
    h1 { font-size: 17pt; margin: 0 0 4pt; color: #111827; }
    h2 { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.5pt; color: #52606d; margin: 0 0 4pt; }
    table { width: 100%; border-collapse: collapse; }
    td, th { vertical-align: top; }
    .muted { color: #616e7c; }
    .small { font-size: 8.5pt; }
    .brand { font-size: 15pt; font-weight: bold; color: #111827; }
    .header td { padding-bottom: 14pt; }
    .meta td { padding: 1pt 0; }
    .meta td.label { color: #616e7c; padding-right: 10pt; }
    .boxes td { width: 33%; padding: 0 10pt 14pt 0; }
    .items th { text-align: left; font-size: 8.5pt; color: #52606d; border-bottom: 1.2pt solid #9aa5b1; padding: 5pt 4pt; }
    .items td { border-bottom: 0.6pt solid #d9e2ec; padding: 5pt 4pt; }
    .num, .items th.num { text-align: right; white-space: nowrap; }
    .items th:first-child { width: 52%; }
    .totals { width: 55%; margin-left: 45%; margin-top: 8pt; }
    .totals td { padding: 2.5pt 4pt; }
    .totals .grand td { font-weight: bold; font-size: 11pt; border-top: 1.2pt solid #9aa5b1; padding-top: 5pt; }
    .section { margin-top: 16pt; }
    .note { margin-top: 14pt; padding: 7pt 9pt; background: #f5f7fa; border-left: 2.5pt solid #9aa5b1; }
    .footer { margin-top: 22pt; font-size: 8.5pt; color: #616e7c; }
</style>
</head>
<body>
<table class="header">
    <tr>
        <td>
            <div class="brand">{{ $store['name'] }}</div>
            <div class="muted small">
                @if ($store['address']){!! nl2br(e($store['address'])) !!}<br>@endif
                @if ($store['email']){{ $store['email'] }}@endif
                @if ($store['phone'])<br>{{ $store['phone'] }}@endif
            </div>
        </td>
        <td style="text-align: right;">
            <h1>@yield('heading')</h1>
            <table class="meta" style="width: auto; margin-left: auto;">
                @yield('meta')
            </table>
        </td>
    </tr>
</table>

<table class="boxes">
    <tr>
        <td>
            <h2>{{ __('Bill to') }}</h2>
            @include('documents.address', ['address' => $order['billing_address']])
        </td>
        <td>
            <h2>{{ __('Ship to') }}</h2>
            @include('documents.address', ['address' => $order['shipping_address']])
        </td>
        <td>
            <h2>{{ __('Payment') }}</h2>
            <div>{{ $order['payment_method'] }}@if ($order['payment_provider']) ({{ $order['payment_provider'] }})@endif</div>
            <div class="muted">{{ $order['payment_status'] }}</div>
            @if ($order['shipping_method'])
                <h2 style="margin-top: 8pt;">{{ __('Shipping') }}</h2>
                <div>{{ $order['shipping_method'] }}</div>
            @endif
        </td>
    </tr>
</table>

@yield('content')

<div class="footer">
    {{ __('Thank you for shopping with :store.', ['store' => $store['name']]) }}@if ($store['email']) {{ __('Questions about this document? Write to :email.', ['email' => $store['email']]) }}@endif
</div>
</body>
</html>
