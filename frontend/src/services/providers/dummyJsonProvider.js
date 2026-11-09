import { normalizeCategory, normalizeProduct, normalizeProductPage } from '../adapters/dummyJsonAdapter'

// Only the fields product cards need: smaller, faster list responses.
const CARD_FIELDS = 'title,category,price,discountPercentage,rating,stock,brand,thumbnail,availabilityStatus,minimumOrderQuantity'
const SUGGESTION_FIELDS = 'title,thumbnail,price,discountPercentage,category'

/** DummyJSON returns every product when `limit` is 0. */
const pageParams = ({ all, limit, skip, sortBy, order }) => ({
  limit: all ? 0 : limit,
  skip,
  sortBy,
  order,
  select: CARD_FIELDS,
})

/**
 * DummyJSON: where each request goes and how to read the answer.
 * Every endpoint function returns `{ path, params }` for apiClient.
 */
export const dummyJsonProvider = {
  name: 'dummyjson',
  request: { credentials: 'omit' }, // token auth in headers; no cookies needed
  catalog: {
    listProducts: (options) => ({ path: '/products', params: pageParams(options) }),
    searchProducts: (query, options) => ({ path: '/products/search', params: { q: query, ...pageParams(options) } }),
    productsByCategory: (slug, options) => ({
      path: `/products/category/${encodeURIComponent(slug)}`,
      params: pageParams(options),
    }),
    productDetail: (id) => ({ path: `/products/${encodeURIComponent(id)}` }),
    suggestions: (query, limit) => ({ path: '/products/search', params: { q: query, limit, select: SUGGESTION_FIELDS } }),
    categories: () => ({ path: '/products/categories' }),
  },
  adapter: {
    productPage: normalizeProductPage,
    product: normalizeProduct,
    categories: (raw) => raw.map(normalizeCategory),
  },
}
