import { parsePriceBound } from './catalog'

/*
 * The catalog's filters, page, and view live in the URL query string:
 *   /categories/smartphones?brand=Apple&brand=Samsung&minPrice=100&rating=4&available=1&page=2&view=list&sort=price-asc
 * so Back/Forward, refresh, bookmarks, and shared links all restore them.
 * Everything read from the URL is validated: users can type anything there.
 */

const RATING_VALUES = [0, 2, 3, 4]
const FILTER_KEYS = ['minPrice', 'maxPrice', 'rating', 'brand', 'available']

/** URL → { filters, page, layout }. Invalid values fall back to defaults. */
export function readCatalogParams(searchParams) {
  const rating = Number(searchParams.get('rating'))
  const page = Number.parseInt(searchParams.get('page') ?? '1', 10)
  const priceParam = (key) => (parsePriceBound(searchParams.get(key)) === null ? '' : searchParams.get(key))

  return {
    filters: {
      minPrice: priceParam('minPrice'),
      maxPrice: priceParam('maxPrice'),
      minRating: RATING_VALUES.includes(rating) ? rating : 0,
      brands: [...new Set(searchParams.getAll('brand'))],
      inStockOnly: searchParams.get('available') === '1',
    },
    page: Number.isInteger(page) && page > 0 ? page : 1,
    layout: searchParams.get('view') === 'list' ? 'list' : 'grid',
  }
}

/** Returns NEW params with `filters` written in (and the page reset to 1). */
export function withFilters(searchParams, filters) {
  const next = new URLSearchParams(searchParams)
  FILTER_KEYS.forEach((key) => next.delete(key))
  next.delete('page')

  if (filters.minPrice !== '') next.set('minPrice', filters.minPrice)
  if (filters.maxPrice !== '') next.set('maxPrice', filters.maxPrice)
  if (filters.minRating > 0) next.set('rating', String(filters.minRating))
  filters.brands.forEach((brand) => next.append('brand', brand))
  if (filters.inStockOnly) next.set('available', '1')
  return next
}

/** Returns NEW params with one key set, or removed when `value` equals `defaultValue`. */
export function withParam(searchParams, key, value, defaultValue) {
  const next = new URLSearchParams(searchParams)
  if (value === defaultValue || value === '' || value === null) next.delete(key)
  else next.set(key, String(value))
  return next
}
