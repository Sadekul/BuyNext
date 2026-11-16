import {
  normalizeCategories,
  normalizeProductDetail,
  normalizeProductPage,
} from '../adapters/laravelAdapter'

// The contract caps per_page; the full-scope catalog asks for the maximum.
// (With Laravel, the catalog should move to server-side filters — see the
// migration notes in docs/backend/API_CONTRACT.md.)
const MAX_PER_PAGE = 100

// BuyNest sort fields → the API's `sort` names.
const SORT_FIELDS = { price: 'price', rating: 'rating', discountPercentage: 'discount', title: 'name' }

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
    searchProducts: (query, options) => ({ path: '/api/catalog/products', params: { search: query, ...pageParams(options) } }),
    productsByCategory: (slug, options) => ({ path: '/api/catalog/products', params: { category: slug, ...pageParams(options) } }),
    productDetail: (id) => ({ path: `/api/catalog/products/${encodeURIComponent(id)}` }),
    suggestions: (query, limit) => ({ path: '/api/catalog/products', params: { search: query, per_page: limit, suggest: 1 } }),
    categories: () => ({ path: '/api/catalog/categories' }),
  },
  adapter: {
    productPage: normalizeProductPage,
    product: normalizeProductDetail,
    categories: normalizeCategories,
  },
}
