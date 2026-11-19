@php($money = fn ($amount) => \App\Services\DocumentPdfs::money($amount, $currency ?? null))
<table class="items">
    <thead>
        <tr>
            <th>Item</th>
            <th class="num">Qty</th>
            <th class="num">Unit price</th>
            <th class="num">Discount</th>
            <th class="num">Amount</th>
        </tr>
    </thead>
    <tbody>
        @foreach ($items as $item)
            <tr>
                <td>
                    {{ $item['name'] }}
                    @if (! empty($item['variant_label']))<span class="muted"> ({{ $item['variant_label'] }})</span>@endif
                    <div class="muted small">
                        @if (! empty($item['sku']))SKU {{ $item['sku'] }}@endif
                        @if (! empty($item['price_label'])) · {{ $item['price_label'] }}@endif
                    </div>
                    {{-- Part B (gift cards): a gift card line may carry its recipient. --}}
                    @if (! empty($item['gift_card']) && is_array($item['gift_card']))
                        <div class="muted small">
                            Gift card for {{ $item['gift_card']['recipient_name'] ?? '' }}@if (! empty($item['gift_card']['recipient_email'])) ({{ $item['gift_card']['recipient_email'] }})@endif
                        </div>
                    @endif
                </td>
                <td class="num">{{ $item['quantity'] }}</td>
                <td class="num">{{ $money($item['sale_price'] ?? $item['price'] ?? null) }}</td>
                <td class="num">{{ \App\Services\DocumentPdfs::positive($item['discount'] ?? null) ? '−'.$money($item['discount']) : '' }}</td>
                <td class="num">{{ $money($item['line_total'] ?? null) }}</td>
            </tr>
        @endforeach
    </tbody>
</table>
