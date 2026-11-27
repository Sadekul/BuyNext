<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>SMS inbox · BuyNest</title>
  <style>
    body{margin:0;font-family:system-ui,Arial,sans-serif;background:#f5f5f4;color:#1c1917}
    main{max-width:860px;margin:0 auto;padding:24px 16px}
    h1{font-size:22px;margin:0 0 4px}
    p.note{margin:0 0 20px;color:#57534e}
    ul{list-style:none;margin:0;padding:0;background:#fff;border-radius:10px;overflow:hidden}
    li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;padding:14px 16px;border-bottom:1px solid #e7e5e4}
    .to{font-weight:600;overflow-wrap:anywhere}.when{color:#57534e;font-size:14px}
    .meta{grid-column:1/-1;color:#57534e;font-size:14px}
    .body{grid-column:1/-1;white-space:pre-wrap;overflow-wrap:anywhere}
    .failed{color:#b91c1c}
    .empty{padding:24px 16px;background:#fff;border-radius:10px}
  </style>
</head>
<body>
<main>
  <h1>SMS inbox</h1>
  <p class="note">Every text BuyNest writes on this computer lands here. With the test mode provider (log) none reach real phones. Newest first; refresh to see new texts.</p>
  @if ($messages->isEmpty())
    <p class="empty">No texts yet. Turn SMS on in the admin (Settings → SMS) and place an order with a Bangladeshi mobile number.</p>
  @else
    <ul>
      @foreach ($messages as $message)
        <li>
          <span class="to">{{ $message->to }}</span>
          <span class="when">{{ $message->created_at->diffForHumans() }}</span>
          <span class="meta">{{ $message->event ?? 'test' }}{{ $message->order ? ' · '.$message->order->number : '' }} · {{ $message->provider }} · <span class="{{ $message->status === 'failed' ? 'failed' : '' }}">{{ $message->status }}{{ $message->error ? ': '.$message->error : '' }}</span> · {{ $message->segments }} SMS ({{ $message->encoding }})</span>
          <span class="body">{{ $message->body }}</span>
        </li>
      @endforeach
    </ul>
  @endif
</main>
</body>
</html>
