import { homeCollectionIds, sampleProducts } from './sampleProducts'

/** Returns sample products in the same order as `ids`, skipping unknown IDs. */
export function getSampleProductsByIds(ids) {
  return ids
    .map((id) => sampleProducts.find((product) => product.id === id))
    .filter(Boolean)
}

/**
 * In-stock sample products with the biggest discounts, largest first.
 * Skips products already shown in another homepage collection.
 */
export function getTopDiscountedProducts(limit = 4) {
  const shownIds = new Set(Object.values(homeCollectionIds).flat())

  return sampleProducts
    .filter((product) => product.stock > 0 && !shownIds.has(product.id))
    .toSorted((a, b) => b.discountPercentage - a.discountPercentage)
    .slice(0, limit)
}
