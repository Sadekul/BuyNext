import { apiClient } from './apiClient'
import { apiProvider } from './providers'

/*
 * Product data, whatever the backend. The provider knows the endpoints and
 * the adapter turns its responses into BuyNest product shapes, so callers
 * (queries/productQueries.js) never see backend-specific details.
 */
const { catalog, adapter } = apiProvider

async function getProductPage({ path, params }, signal) {
  return adapter.productPage(await apiClient.get(path, { params, signal }))
}

/**
 * One page, or — with `{ all: true }` — every page. DummyJSON returns all
 * products in one response; a paginated API (Laravel caps per_page) needs the
 * remaining pages, which are fetched IN PARALLEL with Promise.all.
 */
async function getProductList(endpointFor, { signal, ...options }) {
  const first = await getProductPage(endpointFor(options), signal)
  if (!options.all || first.items.length >= first.total) return first

  const perPage = first.limit
  const pageCount = Math.ceil(first.total / perPage)
  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      getProductPage(endpointFor({ ...options, skip: (index + 1) * perPage }), signal),
    ),
  )
  return { ...first, items: [first, ...rest].flatMap((page) => page.items), limit: first.total }
}

/** All products (one page, or `{ all: true }`), optionally sorted. */
export function getProducts(options = {}) {
  return getProductList(catalog.listProducts, options)
}

/**
 * Server-side search over product names and descriptions. With BuyNest's API
 * the results come ranked by relevance, and `correctedQuery` says when a typo
 * was corrected; `{ exact: true }` searches the words exactly as typed.
 */
export function searchProducts(query, options = {}) {
  return getProductList((pageOptions) => catalog.searchProducts(query, pageOptions), options)
}

/** Products in one category. */
export function getProductsByCategory(categorySlug, options = {}) {
  return getProductList((pageOptions) => catalog.productsByCategory(categorySlug, pageOptions), options)
}

/** Search suggestions: a few matches with only the fields the dropdown shows. */
export function getSearchSuggestions(query, { limit = 6, signal } = {}) {
  return getProductPage(catalog.suggestions(query, limit), signal)
}

/** One product with all its fields. Throws ApiError(404) if missing. */
export async function getProductById(productId, { signal } = {}) {
  const { path, params } = catalog.productDetail(productId)
  return adapter.product(await apiClient.get(path, { params, signal }))
}

/**
 * Phase 11: the products of the compare page, in the order given. BuyNest's
 * API answers them in one request (with specifications); the demo loads each
 * DummyJSON product (no specifications there). Products that no longer exist are skipped.
 */
export async function getCompareProducts(ids, { signal } = {}) {
  if (ids.length === 0) return []
  if (catalog.compare) {
    const { path, params } = catalog.compare(ids)
    const products = adapter.compareList(await apiClient.get(path, { params, signal }))
    return ids.map((id) => products.find((product) => product.id === id)).filter(Boolean)
  }
  const results = await Promise.allSettled(ids.map((id) => getProductById(id, { signal })))
  const failure = results.find((result) => result.status === 'rejected' && result.reason?.status !== 404)
  if (failure) throw failure.reason
  return results.filter((result) => result.status === 'fulfilled').map((result) => result.value)
}
