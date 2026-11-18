import { queryOptions } from '@tanstack/react-query'
import {
  getProductById,
  getProducts,
  getProductsByCategory,
  getSearchSuggestions,
  searchProducts,
} from '../services/productService'
import { getCategories } from '../services/categoryService'

/*
 * Query KEYS identify cached data, like a URL identifies a page. They're
 * arrays, from general to specific, so related entries can be invalidated
 * together: invalidateQueries({ queryKey: productKeys.all }) refreshes every
 * product query at once.
 */
export const productKeys = {
  all: ['products'],
  list: () => [...productKeys.all, 'list', 'all'],
  catalog: (scope) => [...productKeys.all, 'catalog', scope],
  detail: (id) => [...productKeys.all, 'detail', String(id)],
  related: (categorySlug) => [...productKeys.all, 'related', categorySlug],
  suggestions: (query) => [...productKeys.all, 'suggestions', query],
}

export const categoryKeys = { all: ['categories'] }

/*
 * queryOptions() bundles key + fetch function + settings so every component
 * asking for the same data shares one cache entry and one request.
 * TanStack Query passes `signal`, which cancels requests nobody needs anymore.
 */

/** Every product, card fields only (~53 KB). Shared by the homepage and the cart/wishlist price checks. */
export const allProductsQuery = () =>
  queryOptions({
    queryKey: productKeys.list(),
    queryFn: async ({ signal }) => (await getProducts({ all: true, signal })).items,
  })

/**
 * One catalog scope: all products, a search, or a category (filtered
 * client-side afterwards) → { items, correctedQuery }. A search's items keep
 * the API's order (most relevant first, with BuyNest's API); `correctedQuery`
 * is the corrected spelling the API searched for instead, or null.
 * `exact`: search the words as typed ("Search instead for …").
 */
export const catalogQuery = ({ searchQuery, categorySlug, exact = false }) =>
  queryOptions({
    queryKey: productKeys.catalog(searchQuery ? { q: searchQuery, ...(exact && { exact: true }) } : { category: categorySlug ?? 'all' }),
    queryFn: async ({ signal }) => {
      const options = { all: true, signal }
      if (searchQuery) {
        const page = await searchProducts(searchQuery, { ...options, exact })
        return { items: page.items, correctedQuery: exact ? null : (page.correctedQuery ?? null) }
      }
      if (categorySlug) return { items: (await getProductsByCategory(categorySlug, options)).items, correctedQuery: null }
      return { items: (await getProducts(options)).items, correctedQuery: null }
    },
  })

/** Full product details. Quick view and the details page share this cache entry. */
export const productQuery = (productId) =>
  queryOptions({
    queryKey: productKeys.detail(productId),
    queryFn: ({ signal }) => getProductById(productId, { signal }),
  })

export const relatedProductsQuery = (categorySlug, limit) =>
  queryOptions({
    queryKey: productKeys.related(categorySlug),
    queryFn: async ({ signal }) => (await getProductsByCategory(categorySlug, { limit: limit + 1, signal })).items,
  })

/** Search suggestions; disabled (no request) for queries shorter than 2 characters. */
export const suggestionsQuery = (query) =>
  queryOptions({
    queryKey: productKeys.suggestions(query),
    queryFn: ({ signal }) => getSearchSuggestions(query, { signal }),
    enabled: query.length >= 2,
    staleTime: 5 * 60_000,
  })

/** Categories rarely change: keep them fresh for an hour. */
export const categoriesQuery = () =>
  queryOptions({
    queryKey: categoryKeys.all,
    queryFn: ({ signal }) => getCategories({ signal }),
    staleTime: 60 * 60_000,
  })
