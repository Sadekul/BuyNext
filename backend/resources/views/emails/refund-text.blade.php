Refund for order {{ $order->number }}

Hi {{ $name }},

We have refunded ${{ $memo->total }} for order {{ $order->number }} ({{ $memo->number }}). The money goes back by the way you paid ({{ $paymentLabel }}).

@foreach ($memo->items as $item)
{{ $item->orderItem->name }} x {{ $item->quantity }}: ${{ $item->amount }}
@endforeach
@if ((float) $memo->shipping_refund > 0)
Shipping: ${{ $memo->shipping_refund }}
@endif
@if ((float) $memo->adjustment != 0)
Adjustment: {{ (float) $memo->adjustment < 0 ? '-$'.ltrim($memo->adjustment, '-') : '$'.$memo->adjustment }}
@endif
Refund total: ${{ $memo->total }}
@if ($note)

A note from BuyNest: {{ $note }}
@endif

Questions? Reply to this email and mention {{ $order->number }}.
