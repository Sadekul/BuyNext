import { sampleProducts } from './sampleProducts'

/** Returns sample products in the same order as `ids`, skipping unknown IDs. */
export function getSampleProductsByIds(ids) {
  return ids
    .map((id) => sampleProducts.find((product) => product.id === id))
    .filter(Boolean)
}

/** In-stock sample products with the biggest discounts, largest first. */
export function getTopDiscountedProducts(limit = 4) {
  return sampleProducts
    .filter((product) => product.stock > 0)
    .toSorted((a, b) => b.discountPercentage - a.discountPercentage)
    .slice(0, limit)
}
