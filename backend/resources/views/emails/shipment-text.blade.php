Your order is on its way

Hi {{ $name }},

Good news: order {{ $order->number }} has left our warehouse.

Carrier: {{ $carrier }}
@if ($trackingNumber)
Tracking number: {{ $trackingNumber }}
@endif
@if ($trackingUrl)
Track your parcel: {{ $trackingUrl }}
@endif
@if ($note)

A note from BuyNest: {{ $note }}
@endif

Questions? Reply to this email and mention {{ $order->number }}.
