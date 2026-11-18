import { laravel } from '../http.js'
import { failed } from './adminSystem.js'
import { camelPath } from './laravel.js'

/*
 * Phase 11 admin data from BuyNest's Laravel API (docs/backend/PHASE11_CONTRACT.md
 * and its "Implementation notes — backend"): a customer's wishlist and reward
 * points, the wishlist and reward points reports, display currencies, and the
 * phase 11 fields other answers carry (product specifications and links,
 * order and refund points). Only listed fields go either way; the API's
 * snake_case becomes the admin app's camelCase, money strings become numbers.
 * Every function resolves to { ok: true, status, data } or { ok: false, status, body }.
 */

const str = (value) => (typeof value === 'string' ? value : undefined)
const money = (value) => (value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null)
const int = (value) => (Number.isInteger(value) ? value : value !== null && value !== '' && value !== undefined && Number.isInteger(Number(value)) ? Number(value) : null)
const listOf = (data) => (Array.isArray(data?.data) ? data.data : [])
const call = (path, token, request, options = {}) => laravel(`/api/admin/v1${path}`, { token, request, ...options })
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : failed(result, camelPath))
const orderNumber = (value) => (typeof value === 'string' && /^BN-\d{1,12}$/.test(value) ? value : null)
const memoNumber = (value) => (typeof value === 'string' && /^CM-\d{1,12}$/.test(value) ? value : null)
// Only https or root-relative images (never javascript: or data:).
const imageUrl = (value) => (typeof value === 'string' && /^(https?:\/\/|\/)[^\s"'<>]+$/.test(value) ? value : null)

// ---- §2 specifications and §3 product links (on the admin product answer) ----

export const LINK_TYPES = ['related', 'upsell', 'crosssell']

/** [{ label, value }] (rows with a label only). */
export function specifications(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((row) => row && typeof row === 'object' && typeof row.label === 'string' && row.label.trim() !== '')
    .map((row) => ({ label: row.label, value: typeof row.value === 'string' ? row.value : row.value === null || row.value === undefined ? '' : String(row.value) }))
}

/** A linked product: { id, name, sku, image, status }. */
export function linkedProduct(raw) {
  return {
    id: raw.id,
    name: str(raw.name) ?? '',
    sku: str(raw.sku) ?? null,
    image: imageUrl(raw.image ?? raw.image_url ?? raw.thumbnail_url),
    status: str(raw.status) ?? null,
  }
}

/** { related: [...], upsell: [...], crosssell: [...] } (every type, in position order). */
export function productLinks(raw) {
  const links = raw && typeof raw === 'object' ? raw : {}
  return Object.fromEntries(LINK_TYPES.map((type) => [type, (Array.isArray(links[type]) ? links[type] : []).filter((entry) => Number.isInteger(entry?.id)).map(linkedProduct)]))
}

/** The phase 11 fields of an admin product (only what the API sent). */
export function productPhase11(raw) {
  const fields = {}
  if (raw.specifications !== undefined) fields.specifications = specifications(raw.specifications)
  if (raw.links !== undefined) fields.links = productLinks(raw.links)
  return fields
}

// ---- §4 reward points on orders, refunds, credit memos, and the customer grid ----

/** The order's `reward_points: { spent, amount, earned } | null` (earned is null until invoiced) → { spent, amount (money), earned } | null. */
export function orderRewardPoints(raw) {
  const points = raw?.reward_points && typeof raw.reward_points === 'object' ? raw.reward_points : null
  if (!points) return null
  const spent = int(points.spent) ?? 0
  const earned = int(points.earned)
  if (spent <= 0 && earned === null) return null
  return { spent, amount: money(points.amount ?? raw?.totals?.reward_points) ?? 0, earned }
}

/** /refundable: what can still go back as points (refunds settle points first), and the order's points so far. */
export function refundablePoints(raw) {
  const amount = money(raw?.reward_points_refundable)
  if (amount === null) return {}
  const points = raw.reward_points && typeof raw.reward_points === 'object' ? raw.reward_points : {}
  return { rewardPointsRefundable: amount, rewardPoints: { spent: int(points.spent) ?? 0, earned: int(points.earned), reversed: int(points.reversed) ?? 0 } }
}

/** A credit memo's points: returned (and their value), and earned points taken back. */
export function creditMemoPoints(raw) {
  const fields = {}
  if (raw?.reward_points_refund !== undefined || raw?.reward_points_returned !== undefined) {
    fields.rewardPointsRefund = money(raw.reward_points_refund) ?? 0
    fields.rewardPointsReturned = int(raw.reward_points_returned) ?? 0
  }
  if (raw?.reward_points_reversed !== undefined) fields.rewardPointsReversed = int(raw.reward_points_reversed) ?? 0
  return fields
}

/** The customer grid's optional Points column. */
export const customerPoints = (raw) => (raw?.reward_points !== undefined ? { rewardPoints: int(raw.reward_points) ?? 0 } : {})

// ---- §1 a customer's wishlist ----

export function wishlistItem(raw) {
  const product = raw.product && typeof raw.product === 'object' ? raw.product : {}
  const variant = raw.variant && typeof raw.variant === 'object' ? raw.variant : null
  return {
    id: raw.id,
    product: {
      id: product.id ?? null,
      name: str(product.name) ?? '',
      sku: str(product.sku) ?? null,
      image: imageUrl(product.thumbnail_url ?? product.image),
      status: str(product.status) ?? null,
      // Deleted products stay on the list for staff (shoppers never see them).
      deleted: product.deleted === true,
    },
    variant: variant ? { id: variant.id ?? null, label: str(variant.label) ?? '' } : null,
    note: str(raw.note) ?? null,
    addedAt: str(raw.added_at ?? raw.created_at) ?? null,
  }
}

// ---- §4 a customer's reward points ----

export const REWARD_TYPES = ['earn', 'spend', 'cancel_return', 'refund_return', 'refund_reverse', 'signup', 'review', 'adjust']

export function rewardTransaction(raw) {
  return {
    id: raw.id,
    points: int(raw.points) ?? 0,
    balanceAfter: int(raw.balance_after),
    type: REWARD_TYPES.includes(raw.type) ? raw.type : (str(raw.type) ?? 'adjust'),
    orderNumber: orderNumber(raw.order_number ?? raw.order?.number),
    creditMemoNumber: memoNumber(raw.credit_memo_number ?? raw.credit_memo?.number),
    reviewId: int(raw.review_id),
    adminName: str(raw.admin_name ?? raw.admin?.name) ?? null,
    note: str(raw.note) ?? null,
    createdAt: str(raw.created_at) ?? null,
  }
}

/** { data: { enabled, balance, value, point_value, transactions: [...] }, links, meta (the transactions' pages) } → the admin's. */
function rewardsAnswer(data, { limit, skip }) {
  const body = data?.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : {}
  const transactions = Array.isArray(body.transactions) ? body.transactions : []
  return {
    enabled: body.enabled === true,
    balance: int(body.balance) ?? 0,
    value: money(body.value) ?? 0,
    pointValue: money(body.point_value),
    transactions: transactions.map(rewardTransaction),
    total: int(data?.meta?.total) ?? transactions.length,
    limit,
    skip,
    live: true,
  }
}

// ---- reports ----

const wishlistRow = (row) => ({
  productId: row.product_id ?? row.id ?? null,
  name: str(row.name) ?? '',
  sku: str(row.sku) ?? null,
  customers: int(row.customers ?? row.customers_count) ?? 0,
  inStock: typeof row.in_stock === 'boolean' ? row.in_stock : str(row.availability) ? row.availability !== 'out_of_stock' : null,
})

/** { totals: { issued, spent, returned, reversed, adjusted }, series, outstanding_points, outstanding_value, point_value } → the admin's. */
function rewardsReport(raw) {
  const data = raw && typeof raw === 'object' ? raw : {}
  const totals = data.totals && typeof data.totals === 'object' ? data.totals : {}
  return {
    totals: {
      issued: int(totals.issued) ?? 0,
      spent: int(totals.spent) ?? 0,
      returned: int(totals.returned) ?? 0,
      reversed: int(totals.reversed) ?? 0,
      adjusted: int(totals.adjusted) ?? 0,
    },
    series: (Array.isArray(data.series) ? data.series : []).map((point) => ({ period: str(point.period) ?? '', issued: int(point.issued) ?? 0, spent: int(point.spent) ?? 0 })),
    outstandingPoints: int(data.outstanding_points) ?? 0,
    outstandingValue: money(data.outstanding_value) ?? 0,
    pointValue: money(data.point_value),
  }
}

// ---- §5 display currencies ----

export function currencyRate(raw) {
  return {
    id: raw.id,
    code: str(raw.code) ?? '',
    symbol: str(raw.symbol) ?? '',
    rate: money(raw.rate) ?? 0,
    decimals: int(raw.decimals) ?? 2,
    enabled: raw.enabled === true || raw.enabled === 1,
    position: int(raw.position) ?? 0,
    updatedAt: str(raw.updated_at) ?? null,
    // The API's own "updated more than 30 days ago".
    stale: raw.stale === true,
  }
}

/** Validated admin values → the API's fields (the rate as a string with up to 8 decimals). */
export function toCurrencyBody(values) {
  const body = {}
  for (const key of ['code', 'symbol', 'decimals', 'enabled']) if (values[key] !== undefined) body[key] = values[key]
  if (values.rate !== undefined) body.rate = rateText(values.rate)
  return body
}
/** 110.5 → "110.5"; never exponent notation. */
export const rateText = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''))

const currenciesAnswer = (data) => ({ base: str(data?.meta?.base) ?? 'USD', currencies: listOf(data).map(currencyRate), live: true })

// ---- the calls ----

const pageQuery = ({ limit, skip }) => new URLSearchParams({ page: String(Math.floor(skip / limit) + 1), per_page: String(limit) })

export const laravelPhase11Data = {
  async customerWishlist(token, id, request) {
    return answer(await call(`/customers/${id}/wishlist`, token, request), [200], (data) => ({
      items: listOf(data).map(wishlistItem),
      shared: data?.meta?.shared === true,
      sharedAt: str(data?.meta?.shared_at) ?? null,
      live: true,
    }))
  },
  async customerRewards(token, id, page, request) {
    return answer(await call(`/customers/${id}/rewards?${pageQuery(page)}`, token, request), [200], (data) => rewardsAnswer(data, page))
  },
  async adjustRewards(token, id, { points, note }, request) {
    const result = await call(`/customers/${id}/rewards/adjust`, token, request, { method: 'POST', body: { points, note } })
    return answer(result, [200, 201], (data) => {
      const body = data?.data ?? {}
      return { balance: int(body.balance) ?? 0, value: money(body.value) ?? 0, transaction: body.transaction ? rewardTransaction(body.transaction) : null, live: true }
    })
  },

  async wishlistReport(token, params, request) {
    return answer(await call(`/reports/wishlist?${params}`, token, request), [200], (data) => ({ products: listOf(data).map(wishlistRow), live: true }))
  },
  async rewardsReport(token, params, request) {
    return answer(await call(`/reports/rewards?${params}`, token, request), [200], (data) => ({ ...rewardsReport(data?.data), live: true }))
  },

  async listCurrencies(token, request) {
    return answer(await call('/currencies', token, request), [200], currenciesAnswer)
  },
  async createCurrency(token, values, request) {
    return answer(await call('/currencies', token, request, { method: 'POST', body: toCurrencyBody(values) }), [200, 201], (data) => ({ currency: currencyRate(data?.data ?? {}), live: true }))
  },
  async updateCurrency(token, id, values, request) {
    return answer(await call(`/currencies/${id}`, token, request, { method: 'PATCH', body: toCurrencyBody(values) }), [200], (data) => ({ currency: currencyRate(data?.data ?? {}), live: true }))
  },
  // products.edit: the API answers 201 with the copy's admin detail; the admin only needs where to go next.
  async duplicateProduct(token, id, request) {
    return answer(await call(`/products/${id}/duplicate`, token, request, { method: 'POST' }), [200, 201], (data) => {
      const body = data?.data ?? {}
      return { product: { id: int(body.id), name: str(body.name) ?? '', sku: str(body.sku) ?? '', status: str(body.status) ?? 'draft' }, live: true }
    })
  },
  async reorderCurrencies(token, ids, request) {
    return answer(await call('/currencies/reorder', token, request, { method: 'POST', body: { ids } }), [200], currenciesAnswer)
  },
}
