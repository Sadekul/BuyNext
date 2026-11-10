<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Test inbox · BuyNest</title>
  <style>
    body{margin:0;font-family:system-ui,Arial,sans-serif;background:#f5f5f4;color:#1c1917}
    main{max-width:860px;margin:0 auto;padding:24px 16px}
    h1{font-size:22px;margin:0 0 4px}
    p.note{margin:0 0 20px;color:#57534e}
    ul{list-style:none;margin:0;padding:0;background:#fff;border-radius:10px;overflow:hidden}
    li a{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;padding:14px 16px;border-bottom:1px solid #e7e5e4;color:inherit;text-decoration:none}
    li a:hover{background:#eef2ff}
    .to{font-weight:600;overflow-wrap:anywhere}.when{color:#57534e;font-size:14px}.subject{grid-column:1/-1;color:#44403c}
    .empty{padding:24px 16px;background:#fff;border-radius:10px}
  </style>
</head>
<body>
<main>
  <h1>Test inbox</h1>
  <p class="note">Every email BuyNest sends on this computer lands here; none reach real people. Newest first; refresh to see new mail.</p>
  @if ($mails->isEmpty())
    <p class="empty">No emails yet. Create an account in the store to receive a code.</p>
  @else
    <ul>
      @foreach ($mails as $mail)
        <li><a href="{{ route('dev.mailbox.show', $mail) }}">
          <span class="to">{{ $mail->to }}</span>
          <span class="when">{{ $mail->created_at->diffForHumans() }}</span>
          <span class="subject">{{ $mail->subject }}</span>
        </a></li>
      @endforeach
    </ul>
  @endif
</main>
</body>
</html>
