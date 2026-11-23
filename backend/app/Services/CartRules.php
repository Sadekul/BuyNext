<?php

namespace App\Services;

use App\Models\Coupon;
use App\Models\CustomerGroup;
use App\Support\CategoryTree;

/**
 * Cart price rules (phase 7): the best automatic rule, then the typed code.
 *
 * 1. Every active automatic rule (auto_apply) that passes its checks and
 *    applies to at least one line is a candidate; the one saving the most
 *    (merchandise discount + the chosen shipping method's price when it gives
 *    free shipping; a tie goes to the lower id) applies by itself.
 * 2. The typed code is checked and applied on what is left of each line.
 * Each rule's discount is spread over its eligible lines only, and stored
 * per order line, so refunds give back exactly what each line was charged.
 */
class CartRules
{
    /**
     * $lines: Pricing lines (keys kept). With $lock (checkout) the rule rows
     * are locked until the order is written (automatic rules first, then the
     * code, always in that order, so two checkouts can't deadlock).
     *
     * @return array{applied: list<array{coupon: Coupon, discount_cents: int, free_shipping: bool, lines: array<int, int>}>,
     *     coupon: array|null, error: string|null, line_discounts: array<int, int>, discount_cents: int, free_shipping: bool}
     */
    public function apply(array $lines, ?string $code, int $subtotalCents, ?int $customerId, ?string $email, ?CustomerGroup $group,
        int $shippingPriceCents, bool $lock = false): array
    {
        $tree = null;
        $remaining = array_map(fn (array $line) => $line['available'] ? $line['line_cents'] : 0, $lines);
        $applied = [];

        // 1. The best automatic rule.
        $query = Coupon::where('auto_apply', true)->where('is_active', true)->orderBy('id');
        $best = null;
        foreach (($lock ? $query->lockForUpdate() : $query)->get() as $rule) {
            $tree ??= CategoryTree::load();
            $eligible = $rule->eligibleLines($lines, $tree);
            if ($eligible === [] || $rule->problemFor($subtotalCents, $customerId, $email, $group?->id, true)) {
                continue;
            }
            $discounts = $rule->lineDiscounts($lines, $eligible, $remaining);
            $saving = array_sum($discounts) + ($rule->free_shipping ? $shippingPriceCents : 0);
            if (($saving > 0 || $rule->free_shipping) && ($best === null || $saving > $best['saving'])) {
                $best = ['coupon' => $rule, 'lines' => $discounts, 'saving' => $saving];
            }
        }
        if ($best) {
            $applied[] = $this->use($best['coupon'], $best['lines']);
            foreach ($best['lines'] as $key => $cents) {
                $remaining[$key] -= $cents;
            }
        }

        // 2. The typed code (an unknown code gets the same message as an inactive one, so codes can't be probed).
        $coupon = null;
        $error = null;
        $code = Coupon::normalize($code);
        if ($code !== '') {
            $query = Coupon::where('code', $code)->where('auto_apply', false);
            $record = ($lock ? $query->lockForUpdate() : $query)->first();
            $eligible = [];
            if ($record) {
                $tree ??= CategoryTree::load();
                $eligible = $record->eligibleLines($lines, $tree);
            }
            $error = $record ? $record->problemFor($subtotalCents, $customerId, $email, $group?->id, $eligible !== []) : __('This code is not valid.');
            if (! $error) {
                $applied[] = $this->use($record, $record->lineDiscounts($lines, $eligible, $remaining));
                $coupon = ['code' => $record->code, 'description' => $record->description];
            }
        }

        $lineDiscounts = [];
        foreach ($applied as $rule) {
            foreach ($rule['lines'] as $key => $cents) {
                $lineDiscounts[$key] = ($lineDiscounts[$key] ?? 0) + $cents;
            }
        }

        return [
            'applied' => $applied,
            'coupon' => $coupon,
            'error' => $error,
            'line_discounts' => $lineDiscounts,
            'discount_cents' => array_sum($lineDiscounts),
            'free_shipping' => collect($applied)->contains('free_shipping', true),
        ];
    }

    private function use(Coupon $coupon, array $lineDiscounts): array
    {
        return [
            'coupon' => $coupon,
            'discount_cents' => array_sum($lineDiscounts),
            'free_shipping' => $coupon->free_shipping || $coupon->type === 'free_shipping',
            'lines' => $lineDiscounts,
        ];
    }

    /** An applied rule as the cart and orders show it. */
    public static function summary(array $applied): array
    {
        return [
            'id' => $applied['coupon']->id,
            'code' => $applied['coupon']->code,
            'label' => $applied['coupon']->label(),
            'automatic' => (bool) $applied['coupon']->auto_apply,
            'discount' => Pricing::format($applied['discount_cents']),
            'free_shipping' => $applied['free_shipping'],
        ];
    }
}
