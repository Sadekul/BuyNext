/**
 * Purchase limits for a product or cart item:
 * at least `minimumOrderQuantity` (default 1), at most the current stock.
 * `canBuy` is false when out of stock or when stock is below the minimum.
 */
export function getPurchaseLimits({ stock, minimumOrderQuantity }) {
  const min = Math.max(1, minimumOrderQuantity ?? 1)
  const max = stock ?? 0
  return { min, max, canBuy: max > 0 && max >= min }
}

/** Keeps a quantity inside the product's limits. */
export function clampQuantity(quantity, limits) {
  return Math.min(Math.max(quantity, limits.min), limits.max)
}
