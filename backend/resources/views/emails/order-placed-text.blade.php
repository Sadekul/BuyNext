Thanks for your order

Hi {{ $name }},

We received your order {{ $order->number }}.

@foreach ($order->items as $item)
{{ $item->name }} x {{ $item->quantity }}: ${{ $item->line_total }}
@endforeach

Subtotal: ${{ $order->subtotal }}
@if ((float) $order->discount_total > 0)
Discount ({{ $order->coupon_code }}): -${{ $order->discount_total }}
@endif
Shipping ({{ $order->shipping_label }}): ${{ $order->shipping_total }}
Tax: ${{ $order->tax_total }}
Total: ${{ $order->grand_total }}

@php($address = $order->shipping_address)
Shipping to:
{{ $address['first_name'] }} {{ $address['last_name'] }}
{{ $address['line1'] }}@if ($address['line2']), {{ $address['line2'] }}@endif

{{ $address['city'] }}@if ($address['state']), {{ $address['state'] }}@endif {{ $address['postal_code'] }}
{{ $address['country'] }}

Delivery: {{ $order->shipping_label }} ({{ $order->shipping_eta }})
Payment: {{ $paymentLabel }}
{{ $nextSteps }}

Questions? Reply to this email and mention {{ $order->number }}.
