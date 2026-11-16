<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px">
    <tr><td style="padding:32px">
      <p style="margin:0 0 24px;font-size:20px;font-weight:bold;color:#4338ca">BuyNest</p>
      <h1 style="margin:0 0 12px;font-size:22px">Refund for order {{ $order->number }}</h1>
      <p style="margin:0 0 8px">Hi {{ $name }},</p>
      <p style="margin:0 0 16px">We have refunded <strong>${{ $memo->total }}</strong> for order <strong>{{ $order->number }}</strong> ({{ $memo->number }}). The money goes back by the way you paid ({{ $paymentLabel }}).</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:14px">
        @foreach ($memo->items as $item)
          <tr>
            <td style="padding:6px 0;border-bottom:1px solid #e7e5e4">{{ $item->orderItem->displayName() }} &times; {{ $item->quantity }}</td>
            <td style="padding:6px 0;border-bottom:1px solid #e7e5e4;text-align:right">${{ $item->amount }}</td>
          </tr>
        @endforeach
        @if ((float) $memo->shipping_refund > 0)
          <tr><td style="padding:6px 0">Shipping</td><td style="padding:6px 0;text-align:right">${{ $memo->shipping_refund }}</td></tr>
        @endif
        @if ((float) $memo->adjustment != 0)
          <tr><td style="padding:6px 0">Adjustment</td><td style="padding:6px 0;text-align:right">{{ (float) $memo->adjustment < 0 ? '-$'.ltrim($memo->adjustment, '-') : '$'.$memo->adjustment }}</td></tr>
        @endif
        <tr><td style="padding:8px 0;font-weight:bold">Refund total</td><td style="padding:8px 0;text-align:right;font-weight:bold">${{ $memo->total }}</td></tr>
      </table>
      @if ($note)
        <p style="margin:0 0 16px;font-size:14px">A note from BuyNest: {{ $note }}</p>
      @endif
      <p style="margin:0;font-size:14px;color:#57534e">Questions? Reply to this email and mention {{ $order->number }}.</p>
    </td></tr>
  </table>
</body>
</html>
