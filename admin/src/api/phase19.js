import { api } from './client'

/*
 * Phase 19 (docs/backend/PHASE19_CONTRACT.md), BuyNest's backend only: the
 * welcome coupon a new customer gets by email (server/adminPhase19Api.js in
 * the frontend project). Same permissions as Coupons: coupons.view to read,
 * coupons.edit to change. The coupons' new fields (source, issuedToEmail,
 * firstOrderOnly) and the list's ?source filter ride on api/admin.js.
 */

export const phase19Keys = {
  welcome: ['welcome-coupon'],
  codes: (params) => ['welcome-coupon', 'codes', params],
}

/**
 * → { settings: { enabled, triggers: [signup | newsletter], type: percent | fixed, value, minSubtotal | null, validDays, firstOrderOnly },
 *     offer: { label, minSubtotal, … } | null, stats: { issued, used, active, expired } }.
 */
export const getWelcomeCoupon = ({ signal } = {}) => api.get('/api/admin/marketing/welcome-coupon', { signal })
/** Any of the settings → the same answer as getWelcomeCoupon. */
export const updateWelcomeCoupon = (values) => api.put('/api/admin/marketing/welcome-coupon', values)
/** ?status=active|used|expired&q&limit&skip → { codes: [{ code, email, trigger, customer, issuedAt, expiresAt, status, usedOnOrder }], total }. */
export const getWelcomeCodes = (params, { signal } = {}) => api.get('/api/admin/marketing/welcome-coupon/codes', { params, signal })
