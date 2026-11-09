import { apiClient } from './apiClient'
import { normalizeProduct, normalizeProductPage } from './adapters/dummyJsonAdapter'

// Only the fields product cards need: smaller, faster list responses.
// (DummyJSON always includes `id`.)
const PRODUCT_CARD_FIELDS = [
  'title',
  'category',
  'price',
  'discountPercentage',
  'rating',
  'stock',
  'brand',
  'thumbnail',
  'availabilityStatus',
  'minimumOrderQuantity', // needed to add the right quantity from a card
].join(',')

/** DummyJSON returns every product when `limit` is 0. */
export const ALL_PRODUCTS = 0

async function getProductPage(path, { limit, skip, sortBy, order, query, signal } = {}) {
  const data = await apiClient.get(path, {
    params: { q: query, limit, skip, sortBy, order, select: PRODUCT_CARD_FIELDS },
    signal,
  })
  return normalizeProductPage(data)
}

/** GET /products — paginated, optionally sorted. */
export function getProducts(options) {
  return getProductPage('/products', options)
}

/** GET /products/search?q= — server-side search over title and description. */
export function searchProducts(query, options) {
  return getProductPage('/products/search', { ...options, query })
}

/** GET /products/category/:slug — products in one category. */
export function getProductsByCategory(categorySlug, options) {
  return getProductPage(`/products/category/${encodeURIComponent(categorySlug)}`, options)
}

/** GET /products/:id — one product with all its fields. Throws ApiError(404) if missing. */
export async function getProductById(productId, { signal } = {}) {
  const data = await apiClient.get(`/products/${encodeURIComponent(productId)}`, { signal })
  return normalizeProduct(data)
}
