<?php

namespace App\Services;

use App\Models\CustomerGroup;
use App\Models\GiftCard;

/**
 * The result of Pricing::quote(): lines, problems, coupon, shipping, and
 * totals, all in cents. toArray() is the `data` of POST /api/v1/cart/validate
 * (money as "0.00" strings).
 */
final readonly class CartQuote
{
    public function __construct(
        public array $lines,
        public array $problems,
        public ?array $coupon,
        public ?string $couponError,
        public ?array $shippingMethod, // null: shipping is needed but no method is available (shippingError)
        public array $shippingOptions,
        public int $itemCount,
        public int $subtotalCents,
        public int $discountCents,
        public int $shippingCents,
        public int $taxCents,
        public int $totalCents,
        public ?int $couponId = null, // the coupons row applied (checkout counts the use)
        // false: tax is on but no country was given, so the tax (0.00) isn't the real one yet.
        public bool $taxEstimated = true,
        // Phase 6: the shopper's customer group (null only when no group exists) and what its discount took off the subtotal.
        public ?CustomerGroup $group = null,
        public int $groupDiscountCents = 0,
        // Phase 7: the cart price rules applied (CartRules::apply()['applied']: automatic first, then the code).
        public array $appliedRules = [],
        // Phase 10 (part B): shipping table rates and gift cards.
        public bool $shippingRequired = true,      // false: only gift cards (no shipping step)
        public ?string $shippingError = null,      // no method can ship this cart
        public bool $requestedShippingAvailable = true, // the method asked for is offered for this cart
        public int $weightGrams = 0,
        public ?GiftCard $giftCard = null,         // the redeemed card (locked at checkout)
        public int $giftCardCents = 0,             // what it pays
        public ?string $giftCardError = null,
    ) {}

    /** Phase 10 (part B): what is left to pay after the gift card. */
    public function amountDueCents(): int
    {
        return max(0, $this->totalCents - $this->giftCardCents);
    }

    /** The applied rules as the cart and orders show them. */
    public function appliedRulesSummary(): array
    {
        return array_map(CartRules::summary(...), $this->appliedRules);
    }

    public function hasProblems(): bool
    {
        return $this->problems !== [];
    }

    public function toArray(): array
    {
        $money = fn (?int $cents) => $cents === null ? null : Pricing::format($cents);

        return [
            'lines' => array_map(fn (array $line) => [
                'product_id' => $line['product_id'],
                'variant_id' => $line['variant_id'],
                'name' => $line['name'],
                'variant_label' => $line['variant_label'],
                'sku' => $line['sku'],
                'thumbnail_url' => $line['thumbnail_url'],
                'price' => $money($line['price_cents']),
                'discount_percent' => $line['discount_percent'],
                // Phase 6: sale_price is what one unit costs this shopper (after the group discount);
                // base_sale_price is the product's sale price before it.
                'group_discount_percent' => $line['group_discount_percent'],
                'base_sale_price' => $money($line['base_sale_cents']),
                'sale_price' => $money($line['sale_cents']),
                'quantity' => $line['quantity'],
                'line_total' => $money($line['line_cents']),
                // Phase 7: this line's share of the cart rules' discount, and the catalog price rule behind its price.
                'discount' => $money($line['discount_cents'] ?? null),
                'price_rule' => $line['price_rule'] ?? null,
                'price_label' => $line['price_label'] ?? null,
                'stock_quantity' => $line['stock_quantity'],
                'min_order_quantity' => $line['min_order_quantity'],
                'available' => $line['available'],
                // Phase 10 (part B).
                'type' => $line['type'] ?? 'simple',
                'requires_shipping' => $line['requires_shipping'] ?? true,
                'gift_card' => $line['gift_card'] ?? null,
            ], $this->lines),
            'problems' => $this->problems,
            'coupon' => $this->coupon,
            'coupon_error' => $this->couponError,
            'applied_rules' => $this->appliedRulesSummary(),
            'shipping_options' => array_map(fn (array $option) => [
                'id' => $option['id'],
                'label' => $option['label'],
                'eta' => $option['eta'],
                'price' => $money($option['price_cents']),
                'source' => $option['source'] ?? 'flat', // phase 10 (part B): "table" (a table rate) or "flat"
            ], $this->shippingOptions),
            // Phase 10 (part B): shipping table rates and gift cards.
            'shipping_method' => $this->shippingRequired ? ($this->shippingMethod['id'] ?? null) : null,
            'shipping_required' => $this->shippingRequired,
            'shipping_error' => $this->shippingError,
            'weight_grams' => $this->weightGrams,
            'gift_card' => $this->giftCard ? [
                'last4' => $this->giftCard->last4,
                'balance' => $this->giftCard->balance,
                'applied' => Pricing::format($this->giftCardCents),
                'balance_after' => Pricing::format(Pricing::toCents($this->giftCard->balance) - $this->giftCardCents),
                'expires_at' => $this->giftCard->expires_at?->toIso8601ZuluString(),
            ] : null,
            'gift_card_error' => $this->giftCardError,
            'totals' => $this->totals(),
            'tax_estimated' => $this->taxEstimated,
            'customer_group' => $this->group?->summary(),
        ];
    }

    public function totals(): array
    {
        return [
            'item_count' => $this->itemCount,
            'subtotal' => Pricing::format($this->subtotalCents),
            'discount' => Pricing::format($this->discountCents),
            // Already inside the subtotal (the lines are priced after it); shown so the cart can say what the group saved.
            'group_discount' => Pricing::format($this->groupDiscountCents),
            'shipping' => Pricing::format($this->shippingCents),
            'tax' => Pricing::format($this->taxCents),
            'total' => Pricing::format($this->totalCents),
            // Phase 10 (part B): paid with a gift card, and what is left to pay.
            'gift_card' => Pricing::format($this->giftCardCents),
            'amount_due' => Pricing::format($this->amountDueCents()),
        ];
    }
}
