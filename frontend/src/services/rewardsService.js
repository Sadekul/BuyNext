import { apiClient } from './apiClient'

/*
 * Phase 11 §4: the signed-in customer's reward points (REAL_SHOP), through
 * the shop service (server/shopApi.js → server/shop/phase11.js). Wrap calls
 * in useAuth().authorizedRequest.
 */

/**
 * GET /api/shop/me/rewards?page → { balance, value, transactions: [{ id,
 * points (signed), balanceAfter, type, orderNumber, note, createdAt }],
 * total, page, perPage, lastPage }, newest first. `value` is what the
 * balance is worth at checkout, in the store's currency.
 */
export function getRewards({ page = 1, signal } = {}) {
  return apiClient.get('/api/shop/me/rewards', { sameOrigin: true, params: { page }, signal })
}
