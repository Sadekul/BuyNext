/**
 * Applies a percentage discount and rounds to cents.
 * Display only: the backend must always calculate the real charged price.
 */
export function getDiscountedPrice(price, discountPercentage = 0) {
  return Math.round(price * (1 - discountPercentage / 100) * 100) / 100
}

/**
 * Display pricing for a product. DummyJSON's `price` is treated as the list
 * price and `discountPercentage` as the discount off it. Discounts under 1%
 * (e.g. 0.04%) round to 0 and are not shown as a sale.
 */
export function getProductPricing({ price, discountPercentage }) {
  const roundedDiscount = Math.round(discountPercentage)
  const hasDiscount = roundedDiscount >= 1
  return {
    hasDiscount,
    roundedDiscount,
    originalPrice: price,
    salePrice: hasDiscount ? getDiscountedPrice(price, discountPercentage) : price,
  }
}
