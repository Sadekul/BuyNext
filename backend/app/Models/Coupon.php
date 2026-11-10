<?php

namespace App\Models;

use App\Services\Pricing;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A coupon code (Magento's "Cart Price Rule", simplified).
 *   percent        - value % off the merchandise (1-100)
 *   fixed          - value off the merchandise (never more than the merchandise)
 *   free_shipping  - the chosen shipping method costs nothing; no merchandise discount
 * Codes are stored upper case and matched case-insensitively.
 */
#[Fillable([
    'code', 'description', 'type', 'value', 'min_subtotal', 'starts_at', 'ends_at',
    'usage_limit', 'usage_limit_per_customer', 'is_active',
])]
class Coupon extends Model
{
    public const TYPES = ['percent', 'fixed', 'free_shipping'];

    public const STATUSES = ['active', 'inactive', 'scheduled', 'expired', 'used_up'];

    protected function casts(): array
    {
        return [
            'value' => 'decimal:2',
            'min_subtotal' => 'decimal:2',
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
            'usage_limit' => 'integer',
            'usage_limit_per_customer' => 'integer',
            'times_used' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    public function redemptions(): HasMany
    {
        return $this->hasMany(CouponRedemption::class);
    }

    public static function normalize(?string $code): string
    {
        return strtoupper(trim((string) $code));
    }

    /**
     * Why this code can't be used, or null when it can. The checks run in a
     * fixed order and the first failure wins, so the shopper always gets the
     * most useful message. Unknown codes are handled by the caller (same
     * message as an inactive one, so codes can't be probed).
     * $customerId / $email: who is using it (per-customer limit); both null
     * means "not known yet" (a guest cart without an email) and skips that check.
     */
    public function problemFor(int $subtotalCents, ?int $customerId = null, ?string $email = null): ?string
    {
        if (! $this->is_active) {
            return 'This code is not valid.';
        }
        if ($this->starts_at && $this->starts_at->isFuture()) {
            return 'This code isn\'t active yet.';
        }
        if ($this->ends_at && $this->ends_at->isPast()) {
            return 'This code has expired.';
        }
        if ($this->min_subtotal !== null && $subtotalCents < Pricing::toCents($this->min_subtotal)) {
            return 'Spend at least $'.self::money(Pricing::toCents($this->min_subtotal)).' to use this code.';
        }
        if ($this->usage_limit !== null && $this->times_used >= $this->usage_limit) {
            return 'This code has been fully used.';
        }
        if ($this->usage_limit_per_customer !== null && ($customerId !== null || filled($email))) {
            $used = $this->redemptions()
                ->when($customerId !== null,
                    fn ($q) => $q->where('customer_id', $customerId),
                    fn ($q) => $q->where('email', mb_strtolower(trim($email))))
                ->count();
            if ($used >= $this->usage_limit_per_customer) {
                return 'You\'ve already used this code.';
            }
        }

        return null;
    }

    /**
     * A cancelled order gives its coupon use back (call inside the cancel
     * transaction). The coupon row is locked like at checkout, so the counter
     * can't be changed by two requests at once.
     */
    public static function releaseFor(Order $order): void
    {
        foreach (CouponRedemption::where('order_id', $order->id)->get() as $redemption) {
            $coupon = self::whereKey($redemption->coupon_id)->lockForUpdate()->first();
            if ($coupon && $coupon->times_used > 0) {
                $coupon->decrement('times_used');
            }
            $redemption->delete();
        }
    }

    /** The merchandise discount in cents (percent: rounded like the storefront; fixed: capped at the subtotal). */
    public function discountCents(int $subtotalCents): int
    {
        $discount = match ($this->type) {
            'percent' => Pricing::jsRound($subtotalCents * (float) $this->value / 100),
            'fixed' => Pricing::toCents($this->value),
            default => 0,
        };

        return min($discount, $subtotalCents);
    }

    /** For the admin list: inactive, scheduled, expired, used_up, or active (first that applies). */
    public function status(): string
    {
        return match (true) {
            ! $this->is_active => 'inactive',
            $this->starts_at && $this->starts_at->isFuture() => 'scheduled',
            $this->ends_at && $this->ends_at->isPast() => 'expired',
            $this->usage_limit !== null && $this->times_used >= $this->usage_limit => 'used_up',
            default => 'active',
        };
    }

    /** The same rules as status(), in SQL, for ?status= on the admin list. */
    public function scopeWithStatus(Builder $query, string $status): void
    {
        $now = now();
        $scheduled = fn ($q) => $q->whereNotNull('starts_at')->where('starts_at', '>', $now);
        $expired = fn ($q) => $q->whereNotNull('ends_at')->where('ends_at', '<', $now);
        $usedUp = fn ($q) => $q->whereNotNull('usage_limit')->whereColumn('times_used', '>=', 'usage_limit');

        match ($status) {
            'inactive' => $query->where('is_active', false),
            'scheduled' => $query->where('is_active', true)->where($scheduled),
            'expired' => $query->where('is_active', true)->whereNot($scheduled)->where($expired),
            'used_up' => $query->where('is_active', true)->whereNot($scheduled)->whereNot($expired)->where($usedUp),
            default => $query->where('is_active', true)->whereNot($scheduled)->whereNot($expired)->whereNot($usedUp),
        };
    }

    /** "150" for 15000 cents, "150.50" for 15050 (no ".00" in messages). */
    public static function money(int $cents): string
    {
        return $cents % 100 === 0 ? (string) intdiv($cents, 100) : Pricing::format($cents);
    }

    /** A description for codes saved without one: "10% off your order", "$20 off orders of $150 or more", "Free shipping". */
    public static function describe(string $type, int $valueCents, ?int $minSubtotalCents): string
    {
        $text = match ($type) {
            'percent' => rtrim(rtrim(Pricing::format($valueCents), '0'), '.').'% off your order',
            'fixed' => '$'.self::money($valueCents).' off your order',
            default => 'Free shipping',
        };
        if ($minSubtotalCents) {
            $text = ($type === 'free_shipping' ? 'Free shipping on orders' : str_replace('your order', 'orders', $text))
                .' of $'.self::money($minSubtotalCents).' or more';
        }

        return $text;
    }
}
