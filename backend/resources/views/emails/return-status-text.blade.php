{{ $heading }}

Hi {{ $name }},

{{ $intro }}

Return {{ $return->number }} - order {{ $order->number }} - reason: {{ $return->reason }}
@foreach ($items as $item)
- {{ $item['name'] }} x {{ $item['quantity'] }}
@endforeach
@if ($resolution)

{{ $resolution }}
@endif
@if ($note)

A note from BuyNest: {{ $note }}
@endif

Questions? Reply to this email and mention {{ $return->number }}.
