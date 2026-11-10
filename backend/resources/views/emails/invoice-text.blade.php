Payment received

Hi {{ $name }},

Thank you: we received your payment for order {{ $order->number }}.

Invoice {{ $invoice->number }} - ${{ $invoice->amount }}

You can view and print the invoice from your order details.
@if ($note)

A note from BuyNest: {{ $note }}
@endif

Questions? Reply to this email and mention {{ $order->number }}.
