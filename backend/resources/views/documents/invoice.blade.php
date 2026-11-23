@php($money = fn ($amount) => \App\Services\DocumentPdfs::money($amount, $currency ?? null, $locale ?? null))
@extends('documents.layout')

@section('title', __('Invoice').' '.$invoice['number'])
@section('heading', __('Invoice'))

@section('meta')
    <tr><td class="label">{{ __('Invoice') }}</td><td>{{ $invoice['number'] }}</td></tr>
    <tr><td class="label">{{ __('Date') }}</td><td>{{ $invoice['date'] }}</td></tr>
    <tr><td class="label">{{ __('Order') }}</td><td>{{ $order['number'] }}</td></tr>
    <tr><td class="label">{{ __('Order date') }}</td><td>{{ $order['date'] }}</td></tr>
@endsection

@section('content')
    @include('documents.items', ['items' => $items])
    @include('documents.totals', ['totals' => $totals, 'order' => $order])

    @if ($credit_memos)
        <div class="section">
            <h2>{{ __('Refunds') }}</h2>
            <table class="items">
                <thead>
                    <tr><th>{{ __('Credit memo') }}</th><th>{{ __('Date') }}</th><th>{{ __('Refund reference') }}</th><th class="num">{{ __('Amount') }}</th></tr>
                </thead>
                <tbody>
                    @foreach ($credit_memos as $memo)
                        <tr>
                            <td>{{ $memo['number'] }}</td>
                            <td>{{ $memo['date'] }}</td>
                            <td>{{ $memo['refund_reference'] ?? '—' }}</td>
                            <td class="num">{{ $money($memo['total']) }}</td>
                        </tr>
                    @endforeach
                </tbody>
            </table>
        </div>
    @endif

    @if ($invoice['note'])
        <div class="note">{!! nl2br(e($invoice['note'])) !!}</div>
    @endif
@endsection
