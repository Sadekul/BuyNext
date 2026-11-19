import { laravel } from '../http.js'
import { currencyCode, failed } from './laravel.js'

/*
 * A signed-in customer's address book and returns, with BuyNest's Laravel API
 * (docs/backend/PHASE6_CONTRACT.md, sections 1 and 6):
 *   /api/v1/me/addresses[/{id}]          the address book (another customer's id → 404)
 *   /api/v1/orders/{number}/returns      ask to return items of one's own order
 *   /api/v1/returns[/{number}]           one's own returns
 *
 * Same rules as shop/laravel.js: only listed fields go either way, the API's
 * snake_case becomes the storefront's camelCase, and every function resolves
 * to { ok: true, status, data } or { ok: false, status, body }.
 */

const str = (value) => (typeof value === 'string' ? value : undefined)
const trimmed = (value, max) => str(value)?.trim().slice(0, max)
const toInt = (value) => (Number.isInteger(value) ? value : Number.parseInt(value, 10))
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : failed(result))

// ---- address book ----

/** CustomerAddressResource → the storefront's saved address. */
export const fromSavedAddress = (raw = {}) => ({
  id: raw.id,
  firstName: raw.first_name ?? '',
  lastName: raw.last_name ?? '',
  phone: raw.phone ?? '',
  company: raw.company ?? '',
  line1: raw.line1 ?? '',
  line2: raw.line2 ?? '',
  city: raw.city ?? '',
  state: raw.state ?? '',
  postalCode: raw.postal_code ?? '',
  country: raw.country ?? '',
  isDefaultShipping: raw.is_default_shipping === true,
  isDefaultBilling: raw.is_default_billing === true,
})

/**
 * The browser's address → the API's. On PATCH only the fields that were sent
 * go through (a "make this my default" click sends just the flag).
 */
function toSavedAddress(body, { partial = false } = {}) {
  const fields = {
    first_name: trimmed(body.firstName, 120),
    last_name: trimmed(body.lastName, 120),
    phone: trimmed(body.phone, 40),
    company: body.company === null ? null : trimmed(body.company, 200),
    line1: trimmed(body.line1, 240),
    line2: body.line2 === null ? null : trimmed(body.line2, 240),
    city: trimmed(body.city, 160),
    state: body.state === null ? null : trimmed(body.state, 160),
    postal_code: trimmed(body.postalCode, 20),
    country: trimmed(body.country, 60),
    is_default_shipping: typeof body.isDefaultShipping === 'boolean' ? body.isDefaultShipping : undefined,
    is_default_billing: typeof body.isDefaultBilling === 'boolean' ? body.isDefaultBilling : undefined,
  }
  // Empty optional text is "none" (null) so the API clears it. (Caps above are
  // generous: they only stop huge bodies; the API checks the real lengths.)
  for (const key of ['company', 'line2']) if (fields[key] === '') fields[key] = null
  if (!partial) {
    for (const key of ['is_default_shipping', 'is_default_billing']) fields[key] ??= false
  }
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}

// ---- returns ----

/** A returned line: the order line it comes from (name, variant, thumbnail) and how many. */
const fromReturnItem = (raw = {}) => ({
  id: raw.id ?? null,
  orderItemId: raw.order_item_id ?? null,
  productId: raw.product_id ?? null,
  ...(Number.isInteger(raw.variant_id) && { variantId: raw.variant_id }),
  title: str(raw.name) ?? '',
  sku: raw.sku ?? null,
  variantLabel: str(raw.variant_label) ?? null,
  thumbnail: raw.thumbnail_url ?? null,
  quantity: raw.quantity,
  condition: ['unopened', 'opened', 'damaged'].includes(raw.condition) ? raw.condition : null,
})

const money = (value) => (value === null || value === undefined ? null : Number(value))

/**
 * CustomerReturnResource → the customer's view of a return. The list has the
 * summary (itemsCount); the detail adds items, comment, the order, the refund,
 * and the note staff sent with an emailed status change (never internal notes:
 * the API leaves those out).
 */
export const fromReturn = (raw = {}) => ({
  number: raw.number,
  orderNumber: raw.order_number ?? raw.order?.number ?? null,
  status: raw.status,
  reason: str(raw.reason) ?? '',
  resolution: ['refund', 'replace'].includes(raw.resolution) ? raw.resolution : null,
  itemsCount: Number.isInteger(raw.items_count) ? raw.items_count : (raw.items ?? []).reduce((sum, item) => sum + (item.quantity ?? 0), 0),
  createdAt: raw.created_at ?? null,
  updatedAt: raw.updated_at ?? null,
  ...(Array.isArray(raw.items) && {
    items: raw.items.map(fromReturnItem),
    comment: str(raw.comment) ?? null,
    message: str(raw.admin_note) ?? null,
    order: raw.order ? { number: raw.order.number, status: raw.order.status, placedAt: raw.order.placed_at ?? null } : null,
    refund: raw.credit_memo
      ? {
          number: raw.credit_memo.number,
          total: money(raw.credit_memo.total),
          createdAt: raw.credit_memo.created_at ?? null,
          // Phase 12: the refund in its order's currency.
          ...(currencyCode(raw.credit_memo.currency ?? raw.order?.currency) && { currency: currencyCode(raw.credit_memo.currency ?? raw.order?.currency) }),
        }
      : null,
  }),
})

const toReturnItems = (items) =>
  (Array.isArray(items) ? items.slice(0, 100) : []).map((item) => ({ order_item_id: toInt(item?.orderItemId), quantity: toInt(item?.quantity) }))

const page = (data, fallbackPage) => ({
  total: data.meta?.total ?? data.data.length,
  page: data.meta?.current_page ?? fallbackPage,
  perPage: data.meta?.per_page ?? data.data.length,
  lastPage: data.meta?.last_page ?? 1,
})

export const laravelCustomer = {
  async listAddresses(token, request) {
    const result = await laravel('/api/v1/me/addresses', { token, request })
    return answer(result, [200], (data) => ({ addresses: (data.data ?? []).map(fromSavedAddress) }))
  },

  async createAddress(token, body, request) {
    const result = await laravel('/api/v1/me/addresses', { method: 'POST', token, request, body: toSavedAddress(body) })
    return answer(result, [200, 201], (data) => fromSavedAddress(data.data))
  },

  async updateAddress(token, id, body, request) {
    const result = await laravel(`/api/v1/me/addresses/${id}`, { method: 'PATCH', token, request, body: toSavedAddress(body, { partial: true }) })
    return answer(result, [200], (data) => fromSavedAddress(data.data))
  },

  async deleteAddress(token, id, request) {
    const result = await laravel(`/api/v1/me/addresses/${id}`, { method: 'DELETE', token, request })
    return answer(result, [200, 204], () => ({ ok: true }))
  },

  /** { items: [{ orderItemId, quantity }], reason, comment? } → 201 the return. */
  async requestReturn(token, number, body, request) {
    const comment = trimmed(body.comment, 1000)
    const result = await laravel(`/api/v1/orders/${encodeURIComponent(number)}/returns`, {
      method: 'POST',
      token,
      request,
      body: { items: toReturnItems(body.items), reason: trimmed(body.reason, 100) ?? null, comment: comment || null },
    })
    return answer(result, [200, 201], (data) => fromReturn(data.data))
  },

  async listReturns(token, pageNumber, request) {
    const result = await laravel(`/api/v1/returns?page=${pageNumber}`, { token, request })
    return answer(result, [200], (data) => ({ returns: (data.data ?? []).map(fromReturn), ...page(data, pageNumber) }))
  },

  async getReturn(token, number, request) {
    const result = await laravel(`/api/v1/returns/${encodeURIComponent(number)}`, { token, request })
    return answer(result, [200], (data) => fromReturn(data.data))
  },
}
