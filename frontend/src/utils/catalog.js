import { getProductPricing } from './pricing'

/*
 * Client-side catalog logic: pure functions (same input → same output, no
 * side effects), so they are easy to test and reason about.
 *
 * WHY CLIENT-SIDE? DummyJSON can search and list a category on the server,
 * but has no price, rating, or brand filters. So we fetch the whole scope
 * (≤ 194 products, card fields only) and filter/sort/paginate here.
 * A real backend (Laravel) would do this server-side with query parameters,
 * which scales to catalogs far too large to download.
 */

export const EMPTY_FILTERS = {
  minPrice: '',
  maxPrice: '',
  minRating: 0,
  brands: [],
  inStockOnly: false,
}

/** Parses a price input: '' or invalid → null (no bound). */
export function parsePriceBound(value) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

/** True when min and max are both set and min > max. */
export function hasInvalidPriceRange(filters) {
  const min = parsePriceBound(filters.minPrice)
  const max = parsePriceBound(filters.maxPrice)
  return min !== null && max !== null && min > max
}

/** Keeps products that pass every active filter. Price uses the sale price customers pay. */
export function filterProducts(products, filters) {
  const min = parsePriceBound(filters.minPrice)
  const max = parsePriceBound(filters.maxPrice)
  const brandSet = new Set(filters.brands)

  return products.filter((product) => {
    const { salePrice } = getProductPricing(product)
    if (min !== null && salePrice < min) return false
    if (max !== null && salePrice > max) return false
    if (filters.minRating > 0 && (product.rating ?? 0) < filters.minRating) return false
    if (brandSet.size > 0 && !brandSet.has(product.brand)) return false // no brand → excluded only when filtering by brand
    if (filters.inStockOnly && !(product.stock > 0)) return false
    return true
  })
}

const SORT_COMPARATORS = {
  'price-asc': (a, b) => getProductPricing(a).salePrice - getProductPricing(b).salePrice,
  'price-desc': (a, b) => getProductPricing(b).salePrice - getProductPricing(a).salePrice,
  'rating-desc': (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
  'discount-desc': (a, b) => b.discountPercentage - a.discountPercentage,
  'title-asc': (a, b) => a.title.localeCompare(b.title),
}

/** Returns a NEW sorted array (toSorted never mutates the original). "featured" keeps API order. */
export function sortProducts(products, sortValue) {
  const comparator = SORT_COMPARATORS[sortValue]
  return comparator ? products.toSorted(comparator) : products
}

/** Brands present in `products`, alphabetical, with how many products each has. */
export function getBrandOptions(products) {
  const counts = new Map()
  for (const product of products) {
    if (product.brand) counts.set(product.brand, (counts.get(product.brand) ?? 0) + 1)
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Number of filters that differ from their empty value (for the "Filters (3)" label). */
export function countActiveFilters(filters) {
  return (
    (parsePriceBound(filters.minPrice) !== null ? 1 : 0) +
    (parsePriceBound(filters.maxPrice) !== null ? 1 : 0) +
    (filters.minRating > 0 ? 1 : 0) +
    filters.brands.length +
    (filters.inStockOnly ? 1 : 0)
  )
}

/** One page of items plus page metadata. `page` is clamped into range. */
export function paginate(items, page, perPage) {
  const pageCount = Math.max(1, Math.ceil(items.length / perPage))
  const currentPage = Math.min(Math.max(1, page), pageCount)
  const start = (currentPage - 1) * perPage
  return {
    items: items.slice(start, start + perPage),
    currentPage,
    pageCount,
    start: items.length === 0 ? 0 : start + 1,
    end: Math.min(start + perPage, items.length),
  }
}
