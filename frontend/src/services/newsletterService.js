import { apiClient } from './apiClient'

/*
 * The newsletter with BuyNest's API (REAL_SHOP, backend phase 7 §3), through
 * the shop service on this site's own address (server/shopApi.js →
 * server/shop/newsletter.js). Double opt-in: subscribing emails a link to
 * /newsletter/confirm; every newsletter carries a link to
 * /newsletter/unsubscribe. Signed-in customers use the switch in their
 * account instead (authService.updateProfile({ newsletter })).
 */

const SHOP = { sameOrigin: true }

/**
 * POST /api/shop/newsletter → { message }. The answer is the same whether or
 * not the address was already subscribed, so nobody can find out who is.
 * ApiError 422 (fieldErrors.email) for an invalid address, 429 when too many.
 */
export function subscribeToNewsletter(email, { source = 'footer' } = {}) {
  return apiClient.post('/api/shop/newsletter', { email: email.trim(), source }, SHOP)
}

/** POST /api/shop/newsletter/confirm { token } → { message, email, status }. ApiError 422 for a bad or expired link. */
export function confirmNewsletter(token, { signal } = {}) {
  return apiClient.post('/api/shop/newsletter/confirm', { token }, { ...SHOP, signal })
}

/** POST /api/shop/newsletter/unsubscribe { token } → { message, email, status }. ApiError 422 for a bad link. */
export function unsubscribeFromNewsletter(token, { signal } = {}) {
  return apiClient.post('/api/shop/newsletter/unsubscribe', { token }, { ...SHOP, signal })
}
