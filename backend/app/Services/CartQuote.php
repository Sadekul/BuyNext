<?php

namespace App\Services;

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
        public array $shippingMethod,
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
    ) {}

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
                'sale_price' => $money($line['sale_cents']),
                'quantity' => $line['quantity'],
                'line_total' => $money($line['line_cents']),
                'stock_quantity' => $line['stock_quantity'],
                'min_order_quantity' => $line['min_order_quantity'],
                'available' => $line['available'],
            ], $this->lines),
            'problems' => $this->problems,
            'coupon' => $this->coupon,
            'coupon_error' => $this->couponError,
            'shipping_options' => array_map(fn (array $option) => [
                'id' => $option['id'],
                'label' => $option['label'],
                'eta' => $option['eta'],
                'price' => $money($option['price_cents']),
            ], $this->shippingOptions),
            'totals' => $this->totals(),
            'tax_estimated' => $this->taxEstimated,
        ];
    }

    public function totals(): array
    {
        return [
            'item_count' => $this->itemCount,
            'subtotal' => Pricing::format($this->subtotalCents),
            'discount' => Pricing::format($this->discountCents),
            'shipping' => Pricing::format($this->shippingCents),
            'tax' => Pricing::format($this->taxCents),
            'total' => Pricing::format($this->totalCents),
        ];
    }
}
