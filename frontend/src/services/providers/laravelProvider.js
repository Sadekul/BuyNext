import {
  normalizeCategories,
  normalizeCompareList,
  normalizeProductDetail,
  normalizeProductPage,
} from '../adapters/laravelAdapter'

// The contract caps per_page; the full-scope catalog asks for the maximum.
// (With Laravel, the catalog should move to server-side filters — see the
// migration notes in docs/backend/API_CONTRACT.md.)
const MAX_PER_PAGE = 100

// BuyNest sort fields → the API's `sort` names.
// `createdAt` (newest first) is used by the home page's New arrivals (2026-11 redesign);
// `bestSelling` (units sold in the last 90 days, phase 17) by its "Best selling" tab and list.
const SORT_FIELDS = { price: 'price', rating: 'rating', discountPercentage: 'discount', title: 'name', createdAt: 'newest', bestSelling: 'best_selling' }

// Phase 10: "Search instead for <what was typed>": the API searches the words as typed, without correcting typos.
// (the API's `correct=0`; the storefront's own address says ?exact=1).

const pageParams = ({ all, limit = 12, skip = 0, sortBy, order }) => {
  const perPage = all ? MAX_PER_PAGE : limit
  return {
    per_page: perPage,
    page: Math.floor(skip / perPage) + 1,
    sort: SORT_FIELDS[sortBy],
    direction: sortBy ? order : undefined,
  }
}

/**
 * BuyNest's Laravel API, reached through the catalog service on this site's
 * own address (/api/catalog → /api/v1, frontend/server/catalogApi.js): no
 * CORS, no API address in the bundle. The catalog is public, so no cookies
 * are sent (`credentials: 'omit'`); carts and orders use /api/shop
 * (services/shopService.js).
 */
export const laravelProvider = {
  name: 'laravel',
  request: { credentials: 'omit', sameOrigin: true },
  catalog: {
    listProducts: (options) => ({ path: '/api/catalog/products', params: pageParams(options) }),
    searchProducts: (query, options) => ({
      path: '/api/catalog/products',
      params: { search: query, ...pageParams(options), ...(options.exact && { correct: 0 }), ...(options.category && { category: options.category }) },
    }),
    // Phase 17: the API searches within a category (`category` with `search`; subcategories included).
    searchesWithinCategory: true,
    productsByCategory: (slug, options) => ({ path: '/api/catalog/products', params: { category: slug, ...pageParams(options) } }),
    productDetail: (id) => ({ path: `/api/catalog/products/${encodeURIComponent(id)}` }),
    suggestions: (query, limit) => ({ path: '/api/catalog/products', params: { search: query, per_page: limit, suggest: 1 } }),
    categories: () => ({ path: '/api/catalog/categories' }),
    // Phase 11: 2–4 products side by side (visible ones only; unknown ids are skipped).
    compare: (ids) => ({ path: '/api/catalog/products/compare', params: { ids: ids.join(',') } }),
  },
  adapter: {
    productPage: normalizeProductPage,
    product: normalizeProductDetail,
    categories: normalizeCategories,
    compareList: normalizeCompareList,
  },
}
