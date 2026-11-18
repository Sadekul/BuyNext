@if (is_array($address) && $address)
    <div>
        {{ trim(($address['first_name'] ?? '').' '.($address['last_name'] ?? '')) }}<br>
        {{ $address['line1'] ?? '' }}<br>
        @if (! empty($address['line2'])){{ $address['line2'] }}<br>@endif
        {{ $address['city'] ?? '' }}@if (! empty($address['state'])), {{ $address['state'] }}@endif {{ $address['postal_code'] ?? '' }}<br>
        {{ $address['country'] ?? '' }}
    </div>
@else
    <div class="muted">—</div>
@endif
