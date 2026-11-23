@php
    $money = fn ($amount) => \App\Services\DocumentPdfs::money($amount, $currency ?? null, $locale ?? null);
    $positive = \App\Services\DocumentPdfs::positive(...);
    // Keys shown elsewhere in this table, or not money.
    $known = ['item_count', 'subtotal', 'discount', 'shipping', 'tax', 'total', 'gift_card', 'reward_points', 'amount_due', 'paid', 'refunded'];
@endphp
<table class="totals">
    <tr><td>{{ __('Subtotal') }}</td><td class="num">{{ $money($totals['subtotal'] ?? null) }}</td></tr>
    @if ($positive($totals['discount'] ?? null))
        <tr>
            <td>
                {{ __('Discount') }}
                @if ($order['coupon_code'])<span class="muted small">({{ $order['coupon_code'] }})</span>@endif
            </td>
            <td class="num">−{{ $money($totals['discount']) }}</td>
        </tr>
    @endif
    @foreach ($order['applied_rules'] as $rule)
        <tr class="muted small">
            <td>&nbsp;&nbsp;{{ $rule['label'] ?? $rule['code'] ?? __('Discount') }}@if (! empty($rule['free_shipping'])) ({{ __('free shipping') }})@endif</td>
            <td class="num">@if ($positive($rule['discount'] ?? null))−{{ $money($rule['discount']) }}@endif</td>
        </tr>
    @endforeach
    <tr><td>{{ __('Shipping') }}</td><td class="num">{{ $positive($totals['shipping'] ?? null) ? $money($totals['shipping']) : __('Free') }}</td></tr>
    <tr><td>{{ __('Tax') }}</td><td class="num">{{ $money($totals['tax'] ?? null) }}</td></tr>
    <tr class="grand"><td>{{ __('Total') }}</td><td class="num">{{ $money($totals['total'] ?? null) }}</td></tr>
    {{-- Phase 11: what reward points paid (before the gift card). --}}
    @if ($positive($totals['reward_points'] ?? null))
        <tr><td>{{ __('Paid with reward points') }} @if (! empty($order['reward_points']['spent']))<span class="muted small">({{ __(':points pts', ['points' => \App\Support\Locale::number($order['reward_points']['spent'], 0, $locale ?? 'en')]) }})</span>@endif</td><td class="num">−{{ $money($totals['reward_points']) }}</td></tr>
    @endif
    {{-- Part B (gift cards): what a gift card paid, and what was left to pay by the other method. --}}
    @if ($positive($totals['gift_card'] ?? null))
        <tr><td>{{ __('Paid by gift card') }}</td><td class="num">−{{ $money($totals['gift_card']) }}</td></tr>
    @endif
    @if (($positive($totals['gift_card'] ?? null) || $positive($totals['reward_points'] ?? null)) && isset($totals['amount_due']))
        <tr><td>{{ __('Paid by :method', ['method' => $order['payment_method']]) }}</td><td class="num">{{ $money($totals['amount_due']) }}</td></tr>
    @endif
    {{-- Any other amount the order's totals gain later is shown too, with its key as the label. --}}
    @foreach ($totals as $key => $value)
        @if (! in_array($key, $known, true) && is_scalar($value) && is_numeric($value))
            <tr><td>{{ __(\Illuminate\Support\Str::headline($key)) }}</td><td class="num">{{ $money($value) }}</td></tr>
        @endif
    @endforeach
    <tr><td>{{ __('Amount paid') }}</td><td class="num">{{ $money($totals['paid'] ?? null) }}</td></tr>
    @if ($positive($totals['refunded'] ?? null))
        <tr><td>{{ __('Refunded') }}</td><td class="num">−{{ $money($totals['refunded']) }}</td></tr>
    @endif
</table>
