import { api } from './client'

/*
 * Phase 10 (docs/backend/PHASE10_CONTRACT.md), BuyNest's backend only:
 * PDF documents, shipping table rates, gift cards, and the analytics and
 * documents settings (server/adminPhase10Api.js in the frontend project).
 * Permissions: orders.view for the PDFs, settings.edit for table rates,
 * gift_cards.view / gift_cards.manage for gift cards. Without one, the
 * server answers 403 permission_denied (ApiError.code/.permission).
 */

export const phase10Keys = {
  shippingRates: ['shipping-rates'],
  giftCards: (params) => ['gift-cards', params],
  giftCard: (id) => ['gift-card', String(id)],
}

const UPLOAD_TIMEOUT = 120_000

// ---- §2 PDF documents: plain links (the browser sends the session cookie), like the CSV downloads ----

/** The invoice's PDF (INV-100001 → INV-100001.pdf). */
export const invoicePdfUrl = (number) => `/api/admin/invoices/${encodeURIComponent(number)}/pdf`
/** The credit memo's PDF (CM-100001 → CM-100001.pdf). */
export const creditMemoPdfUrl = (number) => `/api/admin/credit-memos/${encodeURIComponent(number)}/pdf`

// ---- §4 shipping table rates (settings.edit) ----

/**
 * { rates: [{ id, method, country ("*" or a country name), minWeightGrams, maxWeightGrams|null, minSubtotal, maxSubtotal|null,
 * price, position }], defaultWeightGrams, methods: [{ id, label, flatPrice, rows }] }. Ranges: min ≤ x < max.
 */
export const getShippingRates = ({ signal } = {}) => api.get('/api/admin/shipping-rates', { signal })
/** { method, country, minWeightGrams, maxWeightGrams, minSubtotal, maxSubtotal, price } → 201 { rate } (last of its method). */
export const createShippingRate = (values) => api.post('/api/admin/shipping-rates', values)
export const updateShippingRate = (id, values) => api.patch(`/api/admin/shipping-rates/${id}`, values)
export const deleteShippingRate = (id) => api.delete(`/api/admin/shipping-rates/${id}`)
/** One method's rows in their new order: { method, ids } → { rates }. */
export const reorderShippingRates = (method, ids) => api.post('/api/admin/shipping-rates/reorder', { method, ids })
/** The CSV download's address (every row). */
export const shippingRatesCsvUrl = () => '/api/admin/shipping-rates/export.csv'
/**
 * A CSV with the export's header (method,country,min_weight_grams,max_weight_grams,min_subtotal,
 * max_subtotal,price,position) → { imported, replaced }. mode "replace" (the default) replaces the
 * rows of the methods in the file; "append" adds to them. Any bad row → 422 with errors
 * { "rows.3.price": [...] } and nothing saved.
 */
export function importShippingRates(file, { mode = 'replace' } = {}) {
  const form = new FormData()
  form.append('file', file)
  form.append('mode', mode)
  return api.post('/api/admin/shipping-rates/import', form, { timeout: UPLOAD_TIMEOUT })
}
/**
 * "Check a cart": { country, weightGrams, subtotal } → { methods: [{ method, label, available,
 * price|null, source: table | flat, rateId|null }], country, weightGrams, subtotal }. Free-shipping rules aren't applied.
 */
export const checkShippingRates = (values) => api.post('/api/admin/shipping-rates/check', values)

// ---- §5 gift cards ----

/** gift_cards.view: ?q (last 4, recipient)&status&limit&skip → { giftCards, total }. */
export const getGiftCards = (params, { signal } = {}) => api.get('/api/admin/gift-cards', { params, signal })
/** The card with its history: { …giftCard, transactions: [{ id, amount, balanceAfter, note, orderNumber, creditMemoNumber, adminName, createdAt }] }. */
export const getGiftCard = (id, { signal } = {}) => api.get(`/api/admin/gift-cards/${id}`, { signal })
/** gift_cards.manage: { amount, recipientName, recipientEmail, message?, expiresAt? (YYYY-MM-DD), sendEmail } → 201 { giftCard, code } (the code once). */
export const createGiftCard = (values) => api.post('/api/admin/gift-cards', values)
/** gift_cards.manage: { amount (negative takes away), note } → { giftCard }. */
export const adjustGiftCard = (id, values) => api.post(`/api/admin/gift-cards/${id}/adjust`, values)
/** gift_cards.manage: the card can no longer be used (there is no delete) → { giftCard }. */
export const disableGiftCard = (id) => api.post(`/api/admin/gift-cards/${id}/disable`, {})
