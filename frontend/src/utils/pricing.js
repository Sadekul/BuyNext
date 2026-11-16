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

/**
 * The discount (in %) that turns `price` into `finalPrice`, when the server's
 * final price is lower than the product's own discount gives (a catalog price
 * rule won, backend phase 7). Otherwise the own discount, unchanged. Showing
 * a rule's price as a percentage means every place that already shows sales
 * (cards, product page, cart, wishlist) shows it the same way.
 */
export function effectiveDiscountPercent(price, ownPercent = 0, finalPrice = null) {
  if (typeof finalPrice !== 'number' || !Number.isFinite(finalPrice) || !(price > 0)) return ownPercent
  const own = getDiscountedPrice(price, ownPercent)
  if (finalPrice >= own - 0.005) return ownPercent
  return Math.min(Math.max((1 - finalPrice / price) * 100, 0), 100)
}
