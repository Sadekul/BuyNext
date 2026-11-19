<?php

namespace App\Models;

use App\Services\Pricing;
use App\Support\CategoryTree;
use App\Support\Currency;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A cart price rule (Magento's "Cart Price Rule"): a coupon code, or an
 * automatic rule (auto_apply, no code).
 *   percent        - value % off the eligible lines (1-100)
 *   fixed          - value off the eligible lines (never more than them)
 *   free_shipping  - the chosen shipping method costs nothing; no merchandise discount
 *   buy_x_get_y    - for every buy_quantity + get_quantity eligible units, the cheapest get_quantity are free
 * Phase 7: free_shipping (bool) can be added to any type; conditions are the
 * customer groups and applies_to (all | categories (with descendants) | products).
 * Codes are stored upper case and matched case-insensitively. The rule's
 * name (an automatic rule has no code) is its description.
 */
#[Fillable([
    'code', 'description', 'type', 'value', 'min_subtotal', 'starts_at', 'ends_at',
    'usage_limit', 'usage_limit_per_customer', 'is_active',
    'customer_group_ids', 'applies_to', 'category_ids', 'product_ids', 'free_shipping', 'buy_quantity', 'get_quantity', 'auto_apply',
])]
class Coupon extends Model
{
    public const TYPES = ['percent', 'fixed', 'free_shipping', 'buy_x_get_y'];

    public const APPLIES_TO = ['all', 'categories', 'products'];

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
            'customer_group_ids' => 'array',
            'category_ids' => 'array',
            'product_ids' => 'array',
            'free_shipping' => 'boolean',
            'buy_quantity' => 'integer',
            'get_quantity' => 'integer',
            'auto_apply' => 'boolean',
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
     * Why this rule can't be used, or null when it can. The checks run in a
     * fixed order and the first failure wins, so the shopper always gets the
     * most useful message. Unknown codes are handled by the caller (same
     * message as an inactive one, so codes can't be probed).
     * $customerId / $email: who is using it (per-customer limit); both null
     * means "not known yet" (a guest cart without an email) and skips that check.
     * $groupId: the shopper's customer group (guests: General).
     * $hasEligibleLines: false when no line of the cart is one the rule applies to
     * (only checked for rules limited to categories or products).
     */
    public function problemFor(int $subtotalCents, ?int $customerId = null, ?string $email = null, ?int $groupId = null,
        bool $hasEligibleLines = true): ?string
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
        $groups = array_map('intval', $this->customer_group_ids ?? []);
        if ($groups !== [] && ! in_array($groupId, $groups, true)) {
            return 'This code isn\'t available for your account.';
        }
        if (! $hasEligibleLines && $this->applies_to !== 'all') {
            return 'This code applies to '.$this->appliesToLabel().' only.';
        }
        if ($this->min_subtotal !== null && $subtotalCents < Pricing::toCents($this->min_subtotal)) {
            return 'Spend $'.Pricing::format(Pricing::toCents($this->min_subtotal) - $subtotalCents).' more to use this code.';
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

    /** "Shoes", "Shoes and Bags", "Shoes, Bags and Hats", or for products up to 3 names, else "selected products". */
    public function appliesToLabel(): string
    {
        $names = $this->applies_to === 'categories'
            ? Category::whereIn('id', $this->category_ids ?? [])->orderBy('name')->pluck('name')->all()
            : Product::withTrashed()->whereIn('id', $this->product_ids ?? [])->orderBy('name')->pluck('name')->all();
        if ($names === [] || ($this->applies_to === 'products' && count($names) > 3)) {
            return $this->applies_to === 'categories' ? 'selected categories' : 'selected products';
        }
        $last = array_pop($names);

        return $names === [] ? $last : implode(', ', $names).' and '.$last;
    }

    /**
     * The keys of the $lines (Pricing lines) this rule applies to: available
     * lines, limited to the rule's categories (with their descendants) or products.
     */
    public function eligibleLines(array $lines, CategoryTree $tree): array
    {
        $categories = null;
        if ($this->applies_to === 'categories') {
            $categories = [];
            foreach ($this->category_ids ?? [] as $id) {
                array_push($categories, ...$tree->descendantIds((int) $id));
            }
        }
        $products = array_map('intval', $this->product_ids ?? []);

        // Phase 10 (part B): gift card lines are never discounted.
        return array_keys(array_filter($lines, fn (array $line) => $line['available'] && ($line['type'] ?? 'simple') !== 'gift_card' && match ($this->applies_to) {
            'categories' => in_array((int) $line['product']->category_id, $categories, true),
            'products' => in_array((int) $line['product_id'], $products, true),
            default => true,
        }));
    }

    /**
     * The discount on each eligible line, in cents ([line key => cents]).
     * $remaining: what is left to pay on each line (its total, less a rule
     * applied before). Percent and fixed are computed on the eligible total
     * and shared in proportion (Pricing::share()); buy X get Y charges the
     * free units to the lines they are on.
     */
    public function lineDiscounts(array $lines, array $eligible, array $remaining): array
    {
        $weights = array_intersect_key($remaining, array_flip($eligible));
        $total = array_sum($weights);
        if ($total <= 0) {
            return [];
        }
        if ($this->type === 'buy_x_get_y') {
            return $this->freeUnits($lines, $weights);
        }
        $discount = match ($this->type) {
            'percent' => Pricing::jsRound($total * (float) $this->value / 100),
            'fixed' => Pricing::toCents($this->value),
            default => 0,
        };

        return $discount > 0 ? Pricing::share(min($discount, $total), $weights) : [];
    }

    /** Buy X get Y: every unit of the eligible lines, cheapest first; per X+Y units, Y are free. */
    private function freeUnits(array $lines, array $weights): array
    {
        $buy = max(1, (int) $this->buy_quantity);
        $get = max(1, (int) $this->get_quantity);
        $units = [];
        foreach (array_keys($weights) as $key) {
            for ($i = 0; $i < $lines[$key]['quantity']; $i++) {
                $units[] = [$lines[$key]['sale_cents'], $key];
            }
        }
        usort($units, fn ($a, $b) => $a <=> $b); // cheapest first (then the earlier line)
        $free = intdiv(count($units), $buy + $get) * $get;
        $discounts = [];
        foreach (array_slice($units, 0, $free) as [$cents, $key]) {
            $discounts[$key] = min(($discounts[$key] ?? 0) + $cents, $weights[$key]);
        }

        return $discounts;
    }

    /** For staff messages: the code, or an automatic rule's name. */
    public function name(): string
    {
        return $this->code ?? "\"{$this->description}\"";
    }

    /** The label shown in the cart and on orders: the description (the rule's name). */
    public function label(): string
    {
        return $this->description;
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
    public static function describe(string $type, int $valueCents, ?int $minSubtotalCents, ?int $buy = null, ?int $get = null): string
    {
        $text = match ($type) {
            'percent' => rtrim(rtrim(Pricing::format($valueCents), '0'), '.').'% off your order',
            'fixed' => Currency::symbol().self::money($valueCents).' off your order',
            'buy_x_get_y' => "Buy {$buy}, get {$get} free",
            default => 'Free shipping',
        };
        if ($minSubtotalCents) {
            $text = match ($type) {
                'free_shipping' => 'Free shipping on orders',
                'buy_x_get_y' => $text.' on orders',
                default => str_replace('your order', 'orders', $text),
            }.' of '.Currency::symbol().self::money($minSubtotalCents).' or more';
        }

        return $text;
    }
}
