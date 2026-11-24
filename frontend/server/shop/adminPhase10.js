import { laravel, laravelFile, laravelMultipart } from '../http.js'
import { failed } from './adminSystem.js'
import { camelPath } from './laravel.js'

/*
 * Phase 10 admin data from BuyNest's Laravel API (docs/backend/PHASE10_CONTRACT.md
 * §4, §5 and "Implementation notes — part B"): shipping table rates and gift
 * cards. Only listed fields go either way; the API's snake_case becomes the
 * admin app's camelCase, money strings become numbers (and go back as
 * 2-decimal strings). Every function resolves to { ok: true, status, data }
 * or { ok: false, status, body } (body = message, field errors in app names,
 * code, permission).
 */

const str = (value) => (typeof value === 'string' ? value : undefined)
const money = (value) => (value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null)
const int = (value) => (Number.isInteger(value) ? value : Number.isInteger(Number(value)) && value !== null && value !== '' ? Number(value) : null)
const cents = (value) => (value === null || value === undefined ? null : Number(value).toFixed(2))
const listOf = (data) => (Array.isArray(data?.data) ? data.data : [])
const call = (path, token, request, options = {}) => laravel(`/api/admin/v1${path}`, { token, request, ...options })

// API field → admin field, for 422 messages (anything else: camelCase path).
const FIELD_NAMES = { notify_recipient: 'sendEmail', weight_grams: 'weightGrams' }
const fieldName = (field) => FIELD_NAMES[field] ?? camelPath(field)
const fail = (result) => failed(result, fieldName)
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : fail(result))

// ---- §4 shipping table rates ----

export const SHIPPING_METHODS = ['standard', 'express', 'nextDay']

/** A table rate row → the admin's. */
export function shippingRate(raw) {
  return {
    id: raw.id,
    method: SHIPPING_METHODS.includes(raw.method) ? raw.method : String(raw.method ?? ''),
    country: str(raw.country) ?? '*',
    minWeightGrams: int(raw.min_weight_grams) ?? 0,
    maxWeightGrams: int(raw.max_weight_grams),
    minSubtotal: money(raw.min_subtotal) ?? 0,
    maxSubtotal: money(raw.max_subtotal),
    price: money(raw.price) ?? 0,
    position: int(raw.position) ?? 0,
    // Phase 14 §3: the delivery zone (null = any) and the delivery time in days, when the API has them.
    ...(raw.zone_code !== undefined && { zoneCode: str(raw.zone_code) || null }),
    ...(raw.eta_days_min !== undefined && { etaDaysMin: int(raw.eta_days_min) }),
    ...(raw.eta_days_max !== undefined && { etaDaysMax: int(raw.eta_days_max) }),
  }
}

/** Validated admin values → the API's row fields (money as 2-decimal strings). */
export function toRateBody(values) {
  const body = {}
  if (values.method !== undefined) body.method = values.method
  if (values.country !== undefined) body.country = values.country
  if (values.minWeightGrams !== undefined) body.min_weight_grams = values.minWeightGrams
  if (values.maxWeightGrams !== undefined) body.max_weight_grams = values.maxWeightGrams
  if (values.minSubtotal !== undefined) body.min_subtotal = cents(values.minSubtotal)
  if (values.maxSubtotal !== undefined) body.max_subtotal = cents(values.maxSubtotal)
  if (values.price !== undefined) body.price = cents(values.price)
  // Phase 14 §3.
  if (values.zoneCode !== undefined) body.zone_code = values.zoneCode
  if (values.etaDaysMin !== undefined) body.eta_days_min = values.etaDaysMin
  if (values.etaDaysMax !== undefined) body.eta_days_max = values.etaDaysMax
  return body
}

function ratesAnswer(data) {
  const meta = data?.meta ?? {}
  return {
    rates: listOf(data).map(shippingRate),
    defaultWeightGrams: int(meta.default_weight_grams),
    methods: (Array.isArray(meta.methods) ? meta.methods : [])
      .filter((method) => SHIPPING_METHODS.includes(method?.id))
      .map((method) => ({ id: method.id, label: str(method.label) ?? method.id, flatPrice: money(method.flat_price), rows: int(method.rows) ?? 0 })),
    live: true,
  }
}

/** "Check a cart": one method's answer. */
function checkedMethod(raw) {
  return {
    method: str(raw.method) ?? '',
    label: str(raw.label) ?? str(raw.method) ?? '',
    available: raw.available === true,
    price: money(raw.price),
    source: raw.source === 'table' ? 'table' : 'flat',
    rateId: int(raw.rate_id),
  }
}

// ---- §5 gift cards ----

const GIFT_CARD_STATUSES = ['active', 'disabled', 'expired']
const last4 = (value) => (typeof value === 'string' && /^[A-Za-z0-9]{4}$/.test(value) ? value.toUpperCase() : null)
// The full code: 16 characters, shown XXXX-XXXX-XXXX-XXXX. Only in the create answer.
const fullCode = (value) => (typeof value === 'string' && /^[A-Za-z0-9-]{16,24}$/.test(value) ? value : null)
const orderNumber = (value) => (typeof value === 'string' && /^BN-\d{1,12}$/.test(value) ? value : null)
const memoNumber = (value) => (typeof value === 'string' && /^CM-\d{1,12}$/.test(value) ? value : null)

/** A gift card → the admin's (never the code: only its last 4 characters). */
export function giftCard(raw) {
  return {
    id: raw.id,
    last4: last4(raw.last4),
    initialBalance: money(raw.initial_balance) ?? 0,
    balance: money(raw.balance) ?? 0,
    currency: str(raw.currency) ?? 'USD',
    status: GIFT_CARD_STATUSES.includes(raw.status) ? raw.status : (str(raw.status) ?? null),
    expiresAt: str(raw.expires_at) ?? null,
    recipientName: str(raw.recipient_name) ?? null,
    recipientEmail: str(raw.recipient_email) ?? null,
    message: str(raw.message) ?? null,
    orderNumber: orderNumber(raw.purchase_order_number),
    createdByAdmin: str(raw.created_by_admin?.name) ?? null,
    createdAt: str(raw.created_at) ?? null,
    updatedAt: str(raw.updated_at) ?? null,
  }
}

export function giftCardTransaction(raw) {
  return {
    id: raw.id,
    amount: money(raw.amount) ?? 0,
    balanceAfter: money(raw.balance_after),
    note: str(raw.note) ?? null,
    orderNumber: orderNumber(raw.order_number),
    creditMemoNumber: memoNumber(raw.credit_memo_number),
    adminName: str(raw.admin_name) ?? null,
    createdAt: str(raw.created_at) ?? null,
  }
}

const giftCardDetail = (raw) => ({ ...giftCard(raw), transactions: (Array.isArray(raw?.transactions) ? raw.transactions : []).map(giftCardTransaction) })

/*
 * ---- §3 and §5 on the order page (shop/admin.js adds these to its order answer) ----
 */

/** What a redeemed gift card paid of the order: { last4, amount } or null. */
export function orderGiftCardPayment(raw) {
  const card = raw?.gift_card && typeof raw.gift_card === 'object' ? raw.gift_card : null
  const amount = money(card?.amount) ?? money(raw?.totals?.gift_card) ?? 0
  if (!(amount > 0)) return null
  return { last4: last4(card?.last4), amount }
}

/** A gift card line's recipient (the card's code is never in an order answer). */
export function lineGiftCard(raw) {
  const details = raw?.gift_card && typeof raw.gift_card === 'object' ? raw.gift_card : null
  if (!details) return null
  return {
    amount: money(details.amount),
    recipientName: str(details.recipient_name) ?? '',
    recipientEmail: str(details.recipient_email) ?? '',
    message: str(details.message) ?? null,
  }
}

/** Cards bought with the order: [{ id, last4, amount, recipientEmail, status }]. */
export function issuedGiftCards(raw) {
  return (Array.isArray(raw?.gift_cards_issued) ? raw.gift_cards_issued : []).map((card) => ({
    id: card.id ?? null,
    last4: last4(card.last4),
    amount: money(card.amount),
    recipientEmail: str(card.recipient_email) ?? null,
    status: str(card.status) ?? null,
  }))
}

// ---- the calls ----

export const laravelPhase10Data = {
  async listRates(token, request) {
    return answer(await call('/shipping-rates', token, request), [200], ratesAnswer)
  },
  async createRate(token, values, request) {
    return answer(await call('/shipping-rates', token, request, { method: 'POST', body: toRateBody(values) }), [200, 201], (data) => ({ rate: shippingRate(data.data ?? {}), live: true }))
  },
  async updateRate(token, id, values, request) {
    return answer(await call(`/shipping-rates/${id}`, token, request, { method: 'PATCH', body: toRateBody(values) }), [200], (data) => ({ rate: shippingRate(data.data ?? {}), live: true }))
  },
  async deleteRate(token, id, request) {
    return answer(await call(`/shipping-rates/${id}`, token, request, { method: 'DELETE' }), [200, 204], () => ({ deleted: true, live: true }))
  },
  async reorderRates(token, { method, ids }, request) {
    return answer(await call('/shipping-rates/reorder', token, request, { method: 'POST', body: { method, ids } }), [200], (data) => ({ rates: listOf(data).map(shippingRate), live: true }))
  },
  async exportRates(token, request) {
    return laravelFile('/api/admin/v1/shipping-rates/export.csv', { token, request })
  },
  async importRates(token, { contentType, bytes }, request) {
    const result = await laravelMultipart('/api/admin/v1/shipping-rates/import', { token, request, contentType, bytes })
    return answer(result, [200, 201], (data) => ({ imported: int(data?.data?.imported) ?? 0, replaced: int(data?.data?.replaced) ?? 0, live: true }))
  },
  async checkRates(token, { country, weightGrams, subtotal }, request) {
    const body = { ...(country && { country }), weight_grams: weightGrams, subtotal: cents(subtotal) }
    return answer(await call('/shipping-rates/check', token, request, { method: 'POST', body }), [200], (data) => ({
      methods: listOf(data).map(checkedMethod),
      country: country ?? null,
      weightGrams,
      subtotal,
      live: true,
    }))
  },

  async listGiftCards(token, { q, status, limit, skip }, request) {
    const params = new URLSearchParams({ page: String(Math.floor(skip / limit) + 1), per_page: String(limit) })
    if (q) params.set('search', q)
    if (status) params.set('status', status)
    return answer(await call(`/gift-cards?${params}`, token, request), [200], (data) => ({
      giftCards: listOf(data).map(giftCard),
      total: data?.meta?.total ?? listOf(data).length,
      limit,
      skip,
      live: true,
    }))
  },
  async getGiftCard(token, id, request) {
    return answer(await call(`/gift-cards/${id}`, token, request), [200], (data) => ({ ...giftCardDetail(data.data ?? {}), live: true }))
  },
  async createGiftCard(token, values, request) {
    const body = {
      amount: cents(values.amount),
      recipient_name: values.recipientName,
      recipient_email: values.recipientEmail,
      message: values.message,
      expires_at: values.expiresAt,
      notify_recipient: values.sendEmail,
    }
    const result = await call('/gift-cards', token, request, { method: 'POST', body })
    // The full code is in this answer only: passed on once, never stored here.
    return answer(result, [200, 201], (data) => ({ giftCard: giftCard(data.data ?? {}), code: fullCode(data.data?.code), live: true }))
  },
  async adjustGiftCard(token, id, { amount, note }, request) {
    const result = await call(`/gift-cards/${id}/adjust`, token, request, { method: 'POST', body: { amount: cents(amount), note } })
    return answer(result, [200], (data) => ({ giftCard: giftCard(data.data ?? {}), live: true }))
  },
  async disableGiftCard(token, id, request) {
    const result = await call(`/gift-cards/${id}`, token, request, { method: 'PATCH', body: { status: 'disabled' } })
    return answer(result, [200], (data) => ({ giftCard: giftCard(data.data ?? {}), live: true }))
  },
}
