<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>{{ $mail->subject }} · Test inbox</title>
  <style>
    body{margin:0;font-family:system-ui,Arial,sans-serif;background:#f5f5f4;color:#1c1917}
    main{max-width:860px;margin:0 auto;padding:24px 16px}
    a{color:#4338ca}
    dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;margin:16px 0;background:#fff;padding:16px;border-radius:10px}
    dt{color:#57534e}dd{margin:0;overflow-wrap:anywhere}
    iframe{width:100%;height:560px;border:0;border-radius:10px;background:#fff}
  </style>
</head>
<body>
<main>
  <a href="{{ route('dev.mailbox') }}">← All emails</a>
  <dl>
    <dt>To</dt><dd>{{ $mail->to }}</dd>
    <dt>Subject</dt><dd>{{ $mail->subject }}</dd>
    <dt>Sent</dt><dd>{{ $mail->created_at->toDayDateTimeString() }}</dd>
  </dl>
  {{-- sandbox: the email's HTML can't run scripts or reach this page --}}
  <iframe title="Email content" sandbox srcdoc="{{ $mail->html ?? e($mail->text) }}"></iframe>
</main>
</body>
</html>
