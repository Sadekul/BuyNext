<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px">
    <tr><td style="padding:32px">
      <p style="margin:0 0 24px;font-size:20px;font-weight:bold;color:#4338ca">BuyNest</p>
      <h1 style="margin:0 0 12px;font-size:22px">Your order is on its way</h1>
      <p style="margin:0 0 8px">Hi {{ $name }},</p>
      <p style="margin:0 0 16px">Good news: order <strong>{{ $order->number }}</strong> has left our warehouse.</p>
      <p style="margin:0 0 16px;padding:12px 16px;background:#eef2ff;border-radius:8px">
        Carrier: <strong>{{ $carrier }}</strong>
        @if ($trackingNumber)
          <br>Tracking number: <strong>{{ $trackingNumber }}</strong>
        @endif
      </p>
      @if ($trackingUrl)
        <p style="margin:0 0 16px"><a href="{{ $trackingUrl }}" style="display:inline-block;padding:10px 18px;background:#4338ca;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold">Track your parcel</a></p>
      @endif
      @if ($note)
        <p style="margin:0 0 16px;font-size:14px">A note from BuyNest: {{ $note }}</p>
      @endif
      <p style="margin:0;font-size:14px;color:#57534e">Questions? Reply to this email and mention {{ $order->number }}.</p>
    </td></tr>
  </table>
</body>
</html>
