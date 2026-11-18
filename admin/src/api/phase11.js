import { api } from './client'

/*
 * Phase 11 (docs/backend/PHASE11_CONTRACT.md), BuyNest's backend only: a
 * customer's wishlist and reward points, the wishlist and reward points
 * reports, and display currencies (server/adminPhase11Api.js in the frontend
 * project). Product specifications and links, order points, and Settings →
 * Reward points ride on the existing product, order, and settings calls.
 * Permissions: customers.view (wishlist, points), rewards.manage (adjust),
 * reports.view, settings.view / settings.edit (currencies). Without one, the
 * server answers 403 permission_denied (ApiError.code/.permission).
 */

export const phase11Keys = {
  wishlist: (customerId) => ['customer-wishlist', String(customerId)],
  rewards: (customerId, params) => ['customer-rewards', String(customerId), params],
  currencies: ['currencies'],
}

// ---- §1 and §4: a customer's wishlist and reward points ----

/** { items: [{ id, product: { id, name, sku, image, status, deleted }, variant: { id, label } | null, note, addedAt }], shared, sharedAt } (every row, hidden products too). */
export const getCustomerWishlist = (customerId, { signal } = {}) => api.get(`/api/admin/customers/${customerId}/wishlist`, { signal })
/** ?limit&skip → { enabled, balance, value, pointValue, transactions: [{ id, points, balanceAfter, type, orderNumber, creditMemoNumber, adminName, note, createdAt }], total }. */
export const getCustomerRewards = (customerId, params, { signal } = {}) => api.get(`/api/admin/customers/${customerId}/rewards`, { params, signal })
/** rewards.manage: { points (signed, not 0), note } → { balance, value, transaction }. Audited; works while rewards are off. */
export const adjustCustomerRewards = (customerId, values) => api.post(`/api/admin/customers/${customerId}/rewards/adjust`, values)

// ---- reports (reports.view) ----
// Through getReport('wishlist' | 'rewards', params) in api/admin.js:
//   wishlist ?from&to&limit   → { products: [{ productId, name, sku, customers, inStock }] } (saved within the dates)
//   rewards  ?from&to&groupBy → { totals: { issued, spent, returned, reversed, adjusted }, series: [{ period, issued, spent }],
//                                outstandingPoints, outstandingValue, pointValue }

// ---- §5 display currencies (settings.view to read, settings.edit to change) ----

/** { base: "USD", currencies: [{ id, code, symbol, rate, decimals, enabled, position, updatedAt, stale }] } in their order. */
export const getCurrencies = ({ signal } = {}) => api.get('/api/admin/currencies', { signal })
/** { code, symbol, rate (units per 1 USD), decimals (0–3), enabled } → 201 { currency } (last in the list). */
export const createCurrency = (values) => api.post('/api/admin/currencies', values)
/** Any of { symbol, rate, decimals, enabled } → { currency }. The code never changes. */
export const updateCurrency = (id, values) => api.patch(`/api/admin/currencies/${id}`, values)
/** Every currency's id, in the new order → { base, currencies }. */
export const reorderCurrencies = (ids) => api.post('/api/admin/currencies/reorder', { ids })

// ---- §3 duplicate a product (products.edit) ----

/** → 201 { product: { id, name, sku, status } }: a draft "(copy)" with the fields, specifications, links and external image URLs; options, variants and uploaded images are not copied. */
export const duplicateProduct = (productId) => api.post(`/api/admin/products/${productId}/duplicate`)
