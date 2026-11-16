import { apiClient } from './apiClient'
import { normalizePhone } from '../utils/validation'

/*
 * A signed-in customer's address book and returns (REAL_SHOP only), through
 * the shop service on this site's own address (server/shopApi.js →
 * server/shop/customer.js). The account always comes from the session cookie,
 * so a customer can only see and change their own.
 *
 * Wrap calls in useAuth().authorizedRequest so an expired session is renewed.
 */

const SHOP = { sameOrigin: true }

/** GET /api/shop/me/addresses → { addresses: [{ id, firstName, …, isDefaultShipping, isDefaultBilling }] } */
export function getAddresses({ signal } = {}) {
  return apiClient.get('/api/shop/me/addresses', { ...SHOP, signal })
}

const addressBody = (address) => ({
  ...address,
  ...(typeof address.phone === 'string' && { phone: normalizePhone(address.phone) }),
})

/** POST /api/shop/me/addresses → the saved address (201). 422 fieldErrors use the form's names (postalCode…). */
export function createAddress(address) {
  return apiClient.post('/api/shop/me/addresses', addressBody(address), SHOP)
}

/** PATCH /api/shop/me/addresses/:id → the saved address. Send only what changes (e.g. { isDefaultShipping: true }). */
export function updateAddress(id, changes) {
  return apiClient.patch(`/api/shop/me/addresses/${encodeURIComponent(id)}`, addressBody(changes), SHOP)
}

/** DELETE /api/shop/me/addresses/:id */
export function deleteAddress(id) {
  return apiClient.delete(`/api/shop/me/addresses/${encodeURIComponent(id)}`, SHOP)
}

/**
 * POST /api/shop/orders/:number/returns { items: [{ orderItemId, quantity }], reason, comment? } → the return (201).
 * 422 when the order can't be returned (window, status, quantities): fieldErrors name `items.0.quantity`, `reason`, …
 */
export function requestReturn(orderNumber, { items, reason, comment }) {
  return apiClient.post(`/api/shop/orders/${encodeURIComponent(orderNumber)}/returns`, { items, reason, comment: comment?.trim() || null }, SHOP)
}

/** GET /api/shop/returns?page → { returns, total, page, perPage, lastPage } */
export function getReturns({ page = 1, signal } = {}) {
  return apiClient.get('/api/shop/returns', { ...SHOP, params: { page }, signal })
}

/** GET /api/shop/returns/:number → one of the customer's returns (404 otherwise). */
export function getReturn(number, { signal } = {}) {
  return apiClient.get(`/api/shop/returns/${encodeURIComponent(number)}`, { ...SHOP, signal })
}
