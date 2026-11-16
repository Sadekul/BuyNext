{{ $heading }}

Hi {{ $firstName }},

{{ $intro }}

Your code: {{ $code }}

The code expires in {{ $minutes }} minutes and works once.
@isset($expiredHint)
{{ $expiredHint }}
@endisset
Didn't ask for this? You can ignore this email. Never share this code: BuyNest staff will never ask for it.
