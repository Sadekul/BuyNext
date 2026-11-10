{{ $heading }}

Hi {{ $name }},

{{ $intro }}

Order {{ $order->number }} - ${{ $order->grand_total }}
@if ($note)

A note from BuyNest: {{ $note }}
@endif

Questions? Reply to this email and mention {{ $order->number }}.
