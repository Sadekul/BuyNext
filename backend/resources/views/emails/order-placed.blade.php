<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px">
    <tr><td style="padding:32px">
      <p style="margin:0 0 24px;font-size:20px;font-weight:bold;color:#4338ca">BuyNest</p>
      <h1 style="margin:0 0 12px;font-size:22px">Thanks for your order</h1>
      <p style="margin:0 0 8px">Hi {{ $name }},</p>
      <p style="margin:0 0 24px">We received your order <strong>{{ $order->number }}</strong>.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:14px">
        @foreach ($order->items as $item)
          <tr>
            <td style="padding:6px 0;border-bottom:1px solid #e7e5e4">{{ $item->name }} &times; {{ $item->quantity }}</td>
            <td style="padding:6px 0;border-bottom:1px solid #e7e5e4;text-align:right">${{ $item->line_total }}</td>
          </tr>
        @endforeach
        <tr><td style="padding:6px 0">Subtotal</td><td style="padding:6px 0;text-align:right">${{ $order->subtotal }}</td></tr>
        @if ((float) $order->discount_total > 0)
          <tr><td style="padding:6px 0">Discount ({{ $order->coupon_code }})</td><td style="padding:6px 0;text-align:right">-${{ $order->discount_total }}</td></tr>
        @endif
        <tr><td style="padding:6px 0">Shipping ({{ $order->shipping_label }})</td><td style="padding:6px 0;text-align:right">${{ $order->shipping_total }}</td></tr>
        <tr><td style="padding:6px 0">Tax</td><td style="padding:6px 0;text-align:right">${{ $order->tax_total }}</td></tr>
        <tr><td style="padding:8px 0;font-weight:bold">Total</td><td style="padding:8px 0;text-align:right;font-weight:bold">${{ $order->grand_total }}</td></tr>
      </table>

      @php($address = $order->shipping_address)
      <p style="margin:0 0 4px;font-weight:bold">Shipping to</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.5">
        {{ $address['first_name'] }} {{ $address['last_name'] }}<br>
        {{ $address['line1'] }}@if ($address['line2']), {{ $address['line2'] }}@endif<br>
        {{ $address['city'] }}@if ($address['state']), {{ $address['state'] }}@endif {{ $address['postal_code'] }}<br>
        {{ $address['country'] }}
      </p>
      <p style="margin:0 0 4px;font-weight:bold">Delivery</p>
      <p style="margin:0 0 16px;font-size:14px">{{ $order->shipping_label }}: {{ $order->shipping_eta }}</p>
      <p style="margin:0 0 4px;font-weight:bold">Payment: {{ $paymentLabel }}</p>
      <p style="margin:0 0 24px;font-size:14px">{{ $nextSteps }}</p>
      <p style="margin:0;font-size:14px;color:#57534e">Questions? Reply to this email and mention {{ $order->number }}.</p>
    </td></tr>
  </table>
</body>
</html>
