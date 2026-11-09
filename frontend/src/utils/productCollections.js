import { getPurchaseLimits } from './inventory'

/** Products in the same order as `ids`, skipping IDs that weren't found. */
export function pickProductsByIds(products, ids) {
  const productsById = new Map(products.map((product) => [product.id, product]))
  return ids.map((id) => productsById.get(id)).filter(Boolean)
}

/**
 * Builds the homepage collections from one product list.
 * Special offers = biggest discounts on products shoppers can actually buy,
 * not already shown elsewhere.
 */
export function buildHomeCollections(products, collectionIds) {
  const shownIds = new Set(Object.values(collectionIds).flat())

  const specialOffers = products
    .filter((product) => getPurchaseLimits(product).canBuy && !shownIds.has(product.id))
    .toSorted((a, b) => b.discountPercentage - a.discountPercentage)
    .slice(0, 4)

  return {
    featured: pickProductsByIds(products, collectionIds.featured),
    newArrivals: pickProductsByIds(products, collectionIds.newArrivals),
    bestSellers: pickProductsByIds(products, collectionIds.bestSellers),
    specialOffers,
  }
}
