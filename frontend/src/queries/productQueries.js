import { queryOptions } from '@tanstack/react-query'
import {
  getProductById,
  getProducts,
  getProductsByCategory,
  getSearchSuggestions,
  searchProducts,
  getCompareProducts,
} from '../services/productService'
import { getCategories } from '../services/categoryService'
import { currentLanguage } from '../i18n'

/*
 * Query KEYS identify cached data, like a URL identifies a page. They're
 * arrays, from general to specific, so related entries can be invalidated
 * together: invalidateQueries({ queryKey: productKeys.all }) refreshes every
 * product query at once.
 *
 * Phase 13: the language is part of the key ("products", "bn"), because the API answers names and
 * descriptions in it. Bangla and English are then cached apart, and a page that renders after the
 * language changed asks for the new key itself, without relying on a refetch arriving in time.
 */
export const productKeys = {
  get all() {
    return ['products', currentLanguage()]
  },
  list: () => [...productKeys.all, 'list', 'all'],
  newest: (limit) => [...productKeys.all, 'list', 'newest', limit],
  catalog: (scope) => [...productKeys.all, 'catalog', scope],
  detail: (id) => [...productKeys.all, 'detail', String(id)],
  related: (categorySlug) => [...productKeys.all, 'related', categorySlug],
  suggestions: (query) => [...productKeys.all, 'suggestions', query],
  compare: (ids) => [...productKeys.all, 'compare', ids.join(',')],
}

export const categoryKeys = {
  get all() {
    return ['categories', currentLanguage()]
  },
}

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

/** The newest products first (the home page's New arrivals; BuyNest's API only, see CAN_SORT_BY_NEWEST). */
export const newestProductsQuery = (limit = 12) =>
  queryOptions({
    queryKey: productKeys.newest(limit),
    queryFn: async ({ signal }) => (await getProducts({ sortBy: 'createdAt', order: 'desc', limit, signal })).items,
    staleTime: 5 * 60_000,
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

/** Phase 11: the compare page's products (ids in the order they were picked). */
export const compareProductsQuery = (ids) =>
  queryOptions({
    queryKey: productKeys.compare(ids),
    queryFn: ({ signal }) => getCompareProducts(ids, { signal }),
    enabled: ids.length > 0,
    placeholderData: (previous) => previous, // removing a column keeps the table on screen
  })
