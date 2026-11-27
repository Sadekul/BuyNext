import { api } from './client'

/*
 * Phase 20 (docs/backend/PHASE20_CONTRACT.md), BuyNest's backend only: SMS
 * notifications for orders (server/adminPhase20Api.js in the frontend
 * project). settings.view to read the settings, settings.edit to change them
 * and send a test; orders.view for the SMS log, orders.edit to retry a text.
 * An order's texts ride on getOrder (api/admin.js): order.sms.
 */

export const phase20Keys = {
  sms: ['sms'],
  messages: (params) => ['sms', 'messages', params],
}

/**
 * → { settings: { enabled, provider: log | ssl_wireless | bulksmsbd, events: [order_placed…], templates: { event: { en, bn } }, confirmLink },
 *     providers: [{ key, label, configured }], stats: { sentToday, failedToday, sent30d }, defaults: { templates } }.
 */
export const getSms = ({ signal } = {}) => api.get('/api/admin/sms', { signal })
/** Any of the settings → the same answer as getSms. */
export const updateSmsSettings = (values) => api.put('/api/admin/sms/settings', values)
/** { to, body? } → { message }: sent through the chosen provider (the log driver only saves it). */
export const sendTestSms = (values) => api.post('/api/admin/sms/test', values)
/** ?status&event&q&limit&skip → { messages: [{ id, order, event, to, body, segments, encoding, status, error, attempts, sentAt, createdAt }], total }. */
export const getSmsMessages = (params, { signal } = {}) => api.get('/api/admin/sms/messages', { params, signal })
/** A failed text, again → { message }. */
export const retrySms = (id) => api.post(`/api/admin/sms/messages/${id}/retry`, {})
