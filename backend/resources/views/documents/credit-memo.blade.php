@php
    $money = fn ($amount) => \App\Services\DocumentPdfs::money($amount, $currency ?? null, $locale ?? null);
    $positive = \App\Services\DocumentPdfs::positive(...);
@endphp
@extends('documents.layout')

@section('title', __('Credit memo').' '.$memo['number'])
@section('heading', __('Credit memo'))

@section('meta')
    <tr><td class="label">{{ __('Credit memo') }}</td><td>{{ $memo['number'] }}</td></tr>
    <tr><td class="label">{{ __('Date') }}</td><td>{{ $memo['date'] }}</td></tr>
    <tr><td class="label">{{ __('Order') }}</td><td>{{ $order['number'] }}</td></tr>
    <tr><td class="label">{{ __('Order date') }}</td><td>{{ $order['date'] }}</td></tr>
    @if ($memo['return_number'])
        <tr><td class="label">{{ __('Return') }}</td><td>{{ $memo['return_number'] }}</td></tr>
    @endif
@endsection

@section('content')
    <table class="items">
        <thead>
            <tr><th>{{ __('Refunded item') }}</th><th class="num">{{ __('Qty') }}</th><th class="num">{{ __('Amount') }}</th></tr>
        </thead>
        <tbody>
            @forelse ($memo['items'] as $item)
                <tr>
                    <td>
                        {{ $item['name'] }}
                        @if (! empty($item['variant_label']))<span class="muted"> ({{ $item['variant_label'] }})</span>@endif
                        @if (! empty($item['sku']))<div class="muted small">SKU {{ $item['sku'] }}</div>@endif
                    </td>
                    <td class="num">{{ \App\Support\Locale::digits($item['quantity'], $locale ?? 'en') }}</td>
                    <td class="num">{{ $money($item['amount']) }}</td>
                </tr>
            @empty
                <tr><td colspan="3" class="muted">{{ __('No items (shipping or an adjustment only).') }}</td></tr>
            @endforelse
        </tbody>
    </table>

    <table class="totals">
        <tr><td>{{ __('Items') }}</td><td class="num">{{ $money($memo['subtotal']) }}</td></tr>
        <tr><td>{{ __('Shipping refund') }}</td><td class="num">{{ $money($memo['shipping_refund']) }}</td></tr>
        @if ((float) $memo['adjustment'] != 0)
            <tr><td>{{ __('Adjustment') }}</td><td class="num">{{ $money($memo['adjustment']) }}</td></tr>
        @endif
        <tr class="grand"><td>{{ __('Total refunded') }}</td><td class="num">{{ $money($memo['total']) }}</td></tr>
        {{-- Part B (gift cards): the part of the refund returned to a gift card. --}}
        @if ($positive($memo['gift_card_refund'] ?? null))
            <tr><td>{{ __('Returned to gift card') }}</td><td class="num">{{ $money($memo['gift_card_refund']) }}</td></tr>
            <tr><td>{{ __('Refunded to :method', ['method' => $order['payment_method']]) }}</td><td class="num">{{ $money($memo['other_refund']) }}</td></tr>
        @endif
    </table>

    <div class="section">
        <h2>{{ __('Refund') }}</h2>
        <div>
            {{ __('Refunded to') }}: {{ $order['payment_method'] }}@if ($order['payment_provider']) ({{ $order['payment_provider'] }})@endif
            @if ($memo['refund_reference'])<br>{{ __('Refund reference') }}: {{ $memo['refund_reference'] }}@endif
            @if ($memo['restocked'])<br><span class="muted">{{ __('The items were put back in stock.') }}</span>@endif
        </div>
    </div>

    <div class="section">
        <h2>{{ __('Order') }} {{ $order['number'] }}</h2>
        <table class="totals" style="margin-top: 0;">
            <tr><td>{{ __('Order total') }}</td><td class="num">{{ $money($totals['total'] ?? null) }}</td></tr>
            <tr><td>{{ __('Amount paid') }}</td><td class="num">{{ $money($totals['paid'] ?? null) }}</td></tr>
            <tr><td>{{ __('Refunded in total') }}</td><td class="num">{{ $money($totals['refunded'] ?? null) }}</td></tr>
        </table>
    </div>

    @if ($memo['note'])
        <div class="note">{!! nl2br(e($memo['note'])) !!}</div>
    @endif
@endsection
