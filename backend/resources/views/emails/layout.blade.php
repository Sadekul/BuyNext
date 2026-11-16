{{-- Phase 7: the store frame around every email body (templates and newsletters). $body is already safe HTML. --}}
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ $subject }}</title>
  <style>
    .bn-body h2 { margin: 0 0 12px; font-size: 22px; }
    .bn-body h3 { margin: 0 0 12px; font-size: 18px; }
    .bn-body p { margin: 0 0 16px; }
    .bn-body a { color: #4338ca; }
    .bn-body blockquote { margin: 0 0 16px; padding: 12px 16px; background: #eef2ff; border-radius: 8px; }
    .bn-body blockquote h3 { margin: 0; font-size: 32px; letter-spacing: 8px; text-align: center; }
    .bn-body ul, .bn-body ol { margin: 0 0 16px; padding-left: 20px; }
    .bn-body table { border-collapse: collapse; }
  </style>
</head>
<body style="margin:0;padding:24px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
  @if ($preheader)
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">{{ $preheader }}</div>
  @endif
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px">
    <tr><td style="padding:32px" class="bn-body">
      <p style="margin:0 0 24px;font-size:20px;font-weight:bold;color:#4338ca">{{ $storeName }}</p>
      {!! $body !!}
    </td></tr>
  </table>
  @if ($footerHtml)
    <p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#78716c;text-align:center">{!! $footerHtml !!}</p>
  @endif
</body>
</html>
