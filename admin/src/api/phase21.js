import { api } from './client'

/*
 * Phase 21 (docs/backend/PHASE21_CONTRACT.md §2), BuyNest's backend only:
 * sales and cash reports (server/adminPhase21Api.js in the frontend project).
 * reports.view to read every report and the courier payments; cash.manage
 * to record, change or delete a courier payment. The sales report's split by
 * payment method and delivery zone rides on getReport('sales') (api/admin.js):
 * byPaymentMethod, byDeliveryZone. Every report's range has its timezone.
 */

export const phase21Keys = {
  payments: (params) => ['report', 'payments', params],
  cod: (params) => ['report', 'cod', params],
  outstanding: (params) => ['report', 'cod-outstanding', params],
  payouts: (params) => ['courier-payouts', params],
}

/**
 * ?from&to&groupBy → { currency, totals: { received, online, codCash, other, refunds, netReceived },
 *   channels: [{ channel, label, amount, count }], series: [{ period, online, codCash, other, refunds, netReceived }],
 *   otherCurrencies: [{ currency, received, count, refunds, netReceived }], range: { from, to, groupBy, timezone } }.
 */
export const getPaymentsReport = (params, { signal } = {}) => api.get('/api/admin/reports/payments', { params, signal })
/**
 * ?from&to → { currency, period: [{ carrier, label, shipped, delivered, returned, cancelled, collected, fees|null, payouts }],
 *   balances: [{ carrier, label, collectedAllTime, feesAllTime|null, feesReported, payoutsAllTime, owed, note, lastPayoutOn }],
 *   outstanding: { orders, amount }, staff: { collected }, range }.
 */
export const getCodReport = (params, { signal } = {}) => api.get('/api/admin/reports/cod', { params, signal })
/** ?carrier&olderThanDays&limit&skip → { orders: [{ number, placedAt, shippedAt, carrier, consignmentId, deliveryStatus, codDue, daysSinceShipped }], total }. */
export const getOutstanding = (params, { signal } = {}) => api.get('/api/admin/reports/cod/outstanding', { params, signal })

/** ?carrier&from&to&limit&skip → { payouts: [{ id, carrier, carrierLabel, amount, fees, currency, receivedOn, reference, note, adminName, createdAt }], total }. */
export const getCourierPayouts = (params, { signal } = {}) => api.get('/api/admin/courier-payouts', { params, signal })
/** { carrier, amount, fees, receivedOn, reference, note, confirmDuplicate? } → { payout }; 409 → ApiError with duplicateOf. */
export const createCourierPayout = (values) => api.post('/api/admin/courier-payouts', values)
export const updateCourierPayout = (id, values) => api.patch(`/api/admin/courier-payouts/${id}`, values)
export const deleteCourierPayout = (id) => api.delete(`/api/admin/courier-payouts/${id}`)
