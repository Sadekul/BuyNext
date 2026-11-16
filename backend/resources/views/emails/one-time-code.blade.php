<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px">
    <tr><td style="padding:32px">
      <p style="margin:0 0 24px;font-size:20px;font-weight:bold;color:#4338ca">BuyNest</p>
      <h1 style="margin:0 0 12px;font-size:22px">{{ $heading }}</h1>
      <p style="margin:0 0 8px">Hi {{ $firstName }},</p>
      <p style="margin:0 0 24px">{{ $intro }}</p>
      <p style="margin:0 0 24px;font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;background:#eef2ff;border-radius:8px;padding:16px">{{ $code }}</p>
      <p style="margin:0 0 8px;font-size:14px;color:#57534e">The code expires in {{ $minutes }} minutes and works once.</p>
      @isset($expiredHint)
        <p style="margin:0 0 8px;font-size:14px;color:#57534e">{{ $expiredHint }}</p>
      @endisset
      <p style="margin:0;font-size:14px;color:#57534e">Didn't ask for this? You can ignore this email. Never share this code: BuyNest staff will never ask for it.</p>
    </td></tr>
  </table>
</body>
</html>
