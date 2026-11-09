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
 * Future BuyNest Laravel API (Sanctum SPA authentication).
 * `credentials: 'include'` sends the session cookie; apiClient copies the
 * XSRF-TOKEN cookie into the X-XSRF-TOKEN header on writes (CSRF protection).
 */
export const laravelProvider = {
  name: 'laravel',
  request: { credentials: 'include', xsrfCookie: 'XSRF-TOKEN' },
  catalog: {
    listProducts: (options) => ({ path: '/api/v1/products', params: pageParams(options) }),
    searchProducts: (query, options) => ({ path: '/api/v1/products', params: { search: query, ...pageParams(options) } }),
    productsByCategory: (slug, options) => ({ path: '/api/v1/products', params: { category: slug, ...pageParams(options) } }),
    productDetail: (id) => ({ path: `/api/v1/products/${encodeURIComponent(id)}` }),
    suggestions: (query, limit) => ({ path: '/api/v1/products', params: { search: query, per_page: limit } }),
    categories: () => ({ path: '/api/v1/categories' }),
  },
  adapter: {
    productPage: normalizeProductPage,
    product: normalizeProductDetail,
    categories: normalizeCategories,
  },
}
