<?php

namespace App\Services;

use App\Models\Admin;
use App\Models\CreditMemo;
use App\Models\Customer;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Review;
use App\Models\RewardTransaction;
use App\Support\Locale;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Phase 11: reward points (loyalty).
 *
 * - The balance (customers.reward_points) changes only here, with the
 *   customer row locked (lockForUpdate), and every change is a
 *   reward_transactions row (points signed). It never goes below 0.
 * - "Once" rules (earn per order, signup bonus, review bonus per product) use
 *   reward_transactions.unique_key, checked under the same lock.
 * - Money: a point is worth rewards.point_value (up to 4 decimals); the
 *   value of N points is round(N × point_value, 2), halves up. Kept in
 *   integers: point_value in ten-thousandths, money in cents.
 * - Nothing is earned or spent while rewards.enabled is false (staff
 *   adjustments, cancel returns, and refunds still work).
 */
class RewardPoints
{
    public function __construct(private Settings $settings, private Audit $audit) {}

    public function enabled(): bool
    {
        return (bool) $this->settings->get('rewards_enabled', false);
    }

    /** point_value in ten-thousandths ("0.0100" → 100). */
    public function pointValue4(): int
    {
        return max(1, (int) round((float) $this->settings->get('rewards_point_value', '0.0100') * 10000));
    }

    public function pointValueString(): string
    {
        return number_format($this->pointValue4() / 10000, 4, '.', '');
    }

    public function earnRateString(): string
    {
        return Pricing::format(Pricing::toCents((string) $this->settings->get('rewards_earn_rate', '1.00')));
    }

    public function minRedeem(): int
    {
        return (int) $this->settings->get('rewards_min_redeem', 100);
    }

    /** What $points are worth, in cents (halves up). */
    public function valueCents(int $points): int
    {
        return intdiv(max(0, $points) * $this->pointValue4() + 50, 100);
    }

    /** The most points worth at most $cents. */
    public function pointsForCents(int $cents): int
    {
        return $cents <= 0 ? 0 : intdiv($cents * 100 + 49, $this->pointValue4());
    }

    /** Points earned by $cents of eligible spend: floor(amount × earn_rate). */
    public function pointsEarnedBy(int $cents): int
    {
        $rate = Pricing::toCents((string) $this->settings->get('rewards_earn_rate', '1.00'));

        return intdiv(max(0, $cents) * $rate, 10000);
    }

    /**
     * Prices the points part of a cart (Pricing::quote()). Returns
     * [info (the cart's `rewards`, null for guests / when off), points used, their cents, error].
     * $payableCents: the grand total less gift card lines (points never pay
     * for gift cards); $merchandiseCents: non-gift-card lines after discounts.
     * With $lock the customer row stays locked until the transaction ends.
     */
    public function quote(?Customer $customer, ?int $requested, int $totalCents, int $payableCents, int $merchandiseCents, bool $lock = false): array
    {
        $requested = max(0, (int) $requested);
        if (! $this->enabled()) {
            return [null, 0, 0, $requested > 0 ? __('Reward points aren\'t available right now.') : null];
        }
        if (! $customer) {
            return [null, 0, 0, $requested > 0 ? __('Sign in to use reward points.') : null];
        }
        $query = Customer::whereKey($customer->id);
        $balance = (int) ($lock ? $query->lockForUpdate()->value('reward_points') : $query->value('reward_points'));
        $maxPercent = max(1, min(100, (int) $this->settings->get('rewards_max_percent', 50)));
        $maxCents = max(0, min(intdiv(max(0, $totalCents) * $maxPercent, 100), $payableCents));
        $maxPoints = min($balance, $this->pointsForCents($maxCents));
        $min = $this->minRedeem();
        if ($maxPoints < $min) {
            $maxPoints = 0;
        }

        $error = null;
        $points = 0;
        if ($requested > 0) {
            $error = match (true) {
                $requested > $balance => $balance === 1 ? __('You have only 1 point.') : __('You have only :count points.', ['count' => Locale::number($balance)]),
                $min > 0 && $requested < $min => __('Use at least :count points.', ['count' => Locale::number($min)]),
                $maxPoints === 0 => __('Reward points can\'t be used on this order.'),
                $requested > $maxPoints => __('You can use at most :count points on this order.', ['count' => Locale::number($maxPoints)]),
                default => null,
            };
            $points = $error === null ? $requested : 0;
        }
        $cents = $this->valueCents($points);

        return [[
            'enabled' => true,
            'balance' => $balance,
            'point_value' => $this->pointValueString(),
            'min_redeem' => $min,
            'max_points' => $maxPoints,
            'earn_estimate' => $this->pointsEarnedBy($merchandiseCents - $cents),
            'applied_points' => $points,
            'applied_amount' => Pricing::format($cents),
        ], $points, $cents, $error];
    }

    /** Checkout: takes $points for $order (the customer row is locked by quote()). */
    public function spend(Customer $customer, int $points, Order $order): void
    {
        if ($points <= 0) {
            return;
        }
        $this->change($customer->id, -$points, 'spend', "Spent on order {$order->number}.", ['order_id' => $order->id],
            insufficient: 'reward_points');
    }

    /** The order was cancelled: spent points not given back yet come back. */
    public function release(Order $order): void
    {
        if (! $order->customer_id || (int) $order->reward_points_spent <= 0) {
            return;
        }
        $back = (int) $order->reward_points_spent - $this->returnedPoints($order);
        if ($back > 0) {
            $this->change($order->customer_id, $back, 'cancel_return', "Order {$order->number} cancelled: points returned.", ['order_id' => $order->id]);
        }
    }

    /** Points already given back for $order (refunds and cancel). */
    public function returnedPoints(Order $order): int
    {
        return (int) RewardTransaction::where('order_id', $order->id)->whereIn('type', ['cancel_return', 'refund_return'])->sum('points');
    }

    /**
     * The order was invoiced (paid): a signed-in customer's order earns
     * floor(eligible × earn_rate) once, eligible = non-gift-card lines after
     * discounts, less what points paid (shipping and tax excluded).
     */
    public function earnFor(Order $order): void
    {
        if (! $this->enabled() || ! $order->customer_id || $order->reward_points_earned !== null) {
            return;
        }
        $order->loadMissing('items');
        $lines = $order->items->reject(fn (OrderItem $item) => $item->isGiftCard())->sum(fn (OrderItem $item) => Pricing::toCents($item->line_total));
        $eligible = $lines - Pricing::toCents($order->discount_total) - Pricing::toCents($order->reward_points_amount ?? 0);
        $points = $this->pointsEarnedBy($eligible);
        if ($points > 0) {
            $this->change($order->customer_id, $points, 'earn', "Earned with order {$order->number}.", ['order_id' => $order->id],
                uniqueKey: "earn:order:{$order->id}");
        }
        $order->forceFill(['reward_points_earned' => $points])->save();
    }

    /** The signup bonus, once per account (after email verification for self-registered accounts). */
    public function signup(Customer $customer): void
    {
        $bonus = (int) $this->settings->get('rewards_signup_bonus', 0);
        if (! $this->enabled() || $bonus <= 0) {
            return;
        }
        $this->change($customer->id, $bonus, 'signup', 'Welcome bonus.', uniqueKey: "signup:customer:{$customer->id}");
    }

    /** The review bonus when a review is approved, once per customer and product. */
    public function review(Review $review): void
    {
        $bonus = (int) $this->settings->get('rewards_review_bonus', 0);
        if (! $this->enabled() || $bonus <= 0 || ! $review->customer_id || $review->status !== 'approved') {
            return;
        }
        $name = $review->product?->name;
        $this->change($review->customer_id, $bonus, 'review', 'Thanks for reviewing'.($name ? " {$name}" : ' a product').'.', ['review_id' => $review->id],
            uniqueKey: "review:customer:{$review->customer_id}:product:{$review->product_id}");
    }

    /** Staff change the balance by $points (signed) with a note; it can't go below 0. Audited. */
    public function adjust(Customer $customer, int $points, string $note, Admin $admin): RewardTransaction
    {
        return DB::transaction(function () use ($customer, $points, $note, $admin) {
            $before = (int) Customer::whereKey($customer->id)->lockForUpdate()->value('reward_points');
            if ($before + $points < 0) {
                throw ValidationException::withMessages(['points' => 'The balance can\'t go below 0 (it is '.number_format($before).' points).']);
            }
            $transaction = $this->change($customer->id, $points, 'adjust', $note, ['admin_id' => $admin->id]);
            $this->audit->record('reward_points.adjusted', "Reward points of {$customer->email}: {$before} → {$transaction->balance_after} ("
                .($points > 0 ? '+' : '')."{$points}).", 'customer', $customer->id,
                ['before' => ['reward_points' => $before], 'after' => ['reward_points' => $transaction->balance_after, 'note' => $note]], $admin);

            return $transaction;
        });
    }

    /** What credit memos already returned as points, in cents (money). */
    public function refundedCents(Order $order): int
    {
        return (int) CreditMemo::where('order_id', $order->id)->get()->sum(fn ($memo) => Pricing::toCents($memo->reward_points_refund ?? 0));
    }

    /** What a new refund can still return as points, in cents. */
    public function refundableCents(Order $order): int
    {
        return max(0, Pricing::toCents($order->reward_points_amount ?? 0) - $this->refundedCents($order));
    }

    /**
     * A credit memo ($memo, already saved with its reward_points_refund)
     * settles points: spent points come back in proportion to the money
     * returned as points, and earned points are taken back in proportion to
     * the refunded share of the order (never below 0; the shortfall is noted).
     * Returns the shortfall (points that couldn't be taken back).
     */
    public function refund(Order $order, CreditMemo $memo): int
    {
        if (! $order->customer_id) {
            return 0;
        }
        $returned = 0;
        $pointsRefund = Pricing::toCents($memo->reward_points_refund ?? 0);
        $spent = (int) $order->reward_points_spent;
        $amount = Pricing::toCents($order->reward_points_amount ?? 0);
        if ($pointsRefund > 0 && $spent > 0 && $amount > 0) {
            $cumulative = $this->refundedCents($order); // includes this memo
            $target = min($spent, intdiv($spent * $cumulative * 2 + $amount, $amount * 2));
            $already = (int) RewardTransaction::where('order_id', $order->id)->where('type', 'refund_return')->sum('points');
            $returned = max(0, $target - $already);
            if ($returned > 0) {
                $this->change($order->customer_id, $returned, 'refund_return', "Refund {$memo->number} on order {$order->number}: points returned.",
                    ['order_id' => $order->id, 'credit_memo_id' => $memo->id]);
            }
        }

        $reversed = 0;
        $shortfall = 0;
        $earned = (int) $order->reward_points_earned;
        $grand = Pricing::toCents($order->grand_total);
        if ($earned > 0 && $grand > 0) {
            $memos = CreditMemo::where('order_id', $order->id)->orderBy('id')->get();
            $after = $memos->sum(fn ($m) => Pricing::toCents($m->total));
            $before = $after - Pricing::toCents($memo->total);
            $round = fn (int $refunded) => min($earned, intdiv($earned * min($refunded, $grand) * 2 + $grand, $grand * 2));
            $intended = $round($after) - $round($before);
            if ($intended > 0) {
                $balance = (int) Customer::whereKey($order->customer_id)->lockForUpdate()->value('reward_points');
                $reversed = min($intended, $balance);
                $shortfall = $intended - $reversed;
                $note = "Refund {$memo->number} on order {$order->number}: earned points taken back."
                    .($shortfall > 0 ? " {$shortfall} ".($shortfall === 1 ? 'point' : 'points').' could not be taken back (balance too low).' : '');
                if ($reversed > 0 || $shortfall > 0) {
                    $this->change($order->customer_id, -$reversed, 'refund_reverse', $note, ['order_id' => $order->id, 'credit_memo_id' => $memo->id]);
                }
            }
        }
        $memo->forceFill(['reward_points_returned' => $returned, 'reward_points_reversed' => $reversed])->save();

        return $shortfall;
    }

    /** A transaction as the customer (and, with $forStaff, staff) see it. */
    public static function api(RewardTransaction $transaction, bool $forStaff = false): array
    {
        return [
            'id' => $transaction->id,
            'points' => $transaction->points,
            'balance_after' => $transaction->balance_after,
            'type' => $transaction->type,
            'order_number' => $transaction->order?->number,
            'note' => $transaction->note,
            'created_at' => $transaction->created_at?->toIso8601ZuluString(),
            ...($forStaff ? [
                'credit_memo_number' => $transaction->creditMemo?->number,
                'admin_name' => $transaction->admin?->name,
            ] : []),
        ];
    }

    /**
     * Moves the balance of customer $customerId by $points (row locked) and
     * records it. $uniqueKey: skipped when a row with this key exists.
     * $insufficient: the field a 422 is reported on when the balance is too low.
     */
    private function change(int $customerId, int $points, string $type, ?string $note, array $refs = [], ?string $uniqueKey = null,
        string $insufficient = 'points'): ?RewardTransaction
    {
        return DB::transaction(function () use ($customerId, $points, $type, $note, $refs, $uniqueKey, $insufficient) {
            $balance = Customer::whereKey($customerId)->lockForUpdate()->value('reward_points');
            if ($balance === null) {
                return null; // the account is gone
            }
            if ($uniqueKey !== null && RewardTransaction::where('unique_key', $uniqueKey)->exists()) {
                return null;
            }
            $after = (int) $balance + $points;
            if ($after < 0) {
                throw ValidationException::withMessages([$insufficient => __('You have only :count points.', ['count' => Locale::number((int) $balance)])]);
            }
            Customer::whereKey($customerId)->update(['reward_points' => $after]);

            return RewardTransaction::create([
                'customer_id' => $customerId,
                'points' => $points,
                'balance_after' => $after,
                'type' => $type,
                'order_id' => $refs['order_id'] ?? null,
                'credit_memo_id' => $refs['credit_memo_id'] ?? null,
                'review_id' => $refs['review_id'] ?? null,
                'admin_id' => $refs['admin_id'] ?? null,
                'note' => $note === null ? null : mb_substr($note, 0, 255),
                'unique_key' => $uniqueKey,
            ]);
        });
    }
}
