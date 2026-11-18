import { json, readBody } from './http.js'
import { LINK_TYPES, laravelPhase11Data } from './shop/adminPhase11.js'

/*
 * Phase 11 admin routes (docs/backend/PHASE11_CONTRACT.md and its
 * implementation notes), BuyNest's Laravel API only. Matched by adminApi.js
 * before its own routes, so the admin session check there runs first; the
 * API then checks the role's permission (customers.view, rewards.manage,
 * reports.view, settings.view/edit) and answers 403 { code:
 * "permission_denied", permission }, passed on unchanged.
 *
 * A CUSTOMER'S WISHLIST AND REWARD POINTS (customers.view; adjusting rewards.manage):
 *   GET    /api/admin/customers/:id/wishlist        → { items: [{ id, product: { id, name, sku, image, status, deleted },
 *                                                     variant: { id, label } | null, note, addedAt }], shared, sharedAt }
 *                                                     (every row: products hidden from shoppers too)
 *   GET    /api/admin/customers/:id/rewards?limit&skip → { enabled, balance, value, pointValue, transactions: [{ id, points, balanceAfter, type,
 *                                                     orderNumber, creditMemoNumber, reviewId, adminName, note, createdAt }], total, limit, skip }
 *   POST   /api/admin/customers/:id/rewards/adjust  { points (signed, not 0), note (1–255) } → { balance, value, transaction }
 *
 * REPORTS (reports.view; the API's names):
 *   GET    /api/admin/reports/wishlist?from&to&limit       → { products: [{ productId, name, sku, customers, inStock }] }
 *   GET    /api/admin/reports/rewards?from&to&groupBy → { totals: { issued, spent, returned, reversed, adjusted },
 *                                                      series: [{ period, issued, spent }], outstandingPoints, outstandingValue, pointValue }
 *
 * DISPLAY CURRENCIES (read settings.view, change settings.edit):
 *   GET    /api/admin/currencies                  → { base, currencies: [{ id, code, symbol, rate, decimals, enabled, position, updatedAt, stale }] }
 *   POST   /api/admin/currencies                  { code, symbol, rate, decimals, enabled } → 201 { currency }
 *   PATCH  /api/admin/currencies/:id              (the same, all optional; code can't change) → { currency }
 *   POST   /api/admin/currencies/reorder          { ids } (every currency once) → { base, currencies }
 *
 * DUPLICATE A PRODUCT (products.edit):
 *   POST   /api/admin/products/:id/duplicate      → 201 { product: { id, name, sku, status } } (a draft "(copy)"; options,
 *                                                     variants and uploaded images are not copied)
 *
 * Product specifications and links, order and refund points, the customer
 * grid's points, and Settings → Reward points ride on the existing routes
 * (adminApi.js, adminSystemApi.js); their checks are exported from here.
 */

const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const LIVE_ONLY = 'This needs the BuyNest backend; the demo data has no wishlists, reward points, or currencies.'
const live = (handler) => (ctx) => (realData() ? handler(ctx) : json({ message: LIVE_ONLY }, 404))
const fromLaravel = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))
const invalid = (errors) => json({ message: 'Please check the highlighted fields.', errors }, 422)
const isId = (value) => /^\d{1,9}$/.test(value ?? '')
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && !Number.isNaN(Date.parse(value))
const decimals = (value, places) => Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) < 1e-6

// ---- §2 specifications and §3 links: rules for the product routes (adminApi.js) ----

export const MAX_SPECIFICATIONS = 40
export const MAX_LINKS = 20

/** null when fine, else the message (the product form shows it on the Specifications section). */
export function specificationsProblem(value) {
  if (!Array.isArray(value) || value.length > MAX_SPECIFICATIONS) return `Keep up to ${MAX_SPECIFICATIONS} specification rows.`
  const seen = new Set()
  for (const row of value) {
    const label = typeof row?.label === 'string' ? row.label.trim() : ''
    const text = typeof row?.value === 'string' ? row.value.trim() : null
    if (!label || label.length > 60) return 'Give every row a label of up to 60 characters.'
    if (text === null || text === '' || text.length > 255) return 'Give every row a value of up to 255 characters.'
    if (seen.has(label.toLowerCase())) return `Each label once: "${label}" is there twice.`
    seen.add(label.toLowerCase())
  }
  return null
}
export const cleanSpecifications = (value) => value.map((row) => ({ label: row.label.trim(), value: row.value.trim() }))

/** { related?, upsell?, crosssell? }: lists of product ids, each at most 20, no repeats. */
export function linksProblem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Send the linked products by type.'
  const keys = Object.keys(value)
  if (keys.length === 0 || !keys.every((key) => LINK_TYPES.includes(key))) return 'Send the linked products by type (related, upsell, crosssell).'
  for (const key of keys) {
    const ids = value[key]
    if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id) && id > 0)) return 'Choose products from the store.'
    if (ids.length > MAX_LINKS) return `Link up to ${MAX_LINKS} products of each kind.`
    if (new Set(ids).size !== ids.length) return 'Link each product once per kind.'
  }
  return null
}

// ---- §4 Settings → Reward points: rules for PATCH settings (adminSystemApi.js) ----

const isBoolean = (message) => (value) => (typeof value === 'boolean' ? null : message)
const wholeNumber = (min, max, message) => (value) => (Number.isInteger(value) && value >= min && value <= max ? null : message)
export const REWARD_SETTING_RULES = {
  enabled: isBoolean('Choose whether reward points are on.'),
  earnRate: (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000 && decimals(value, 2) ? null : 'Enter the points per $1.00 from 0 to 1,000, with at most 2 decimals.'),
  pointValue: (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100 && decimals(value, 4) ? null : 'Enter the value of one point, above 0 and up to 100, with at most 4 decimals.'),
  minRedeem: wholeNumber(0, 1_000_000, 'Enter a whole number of points from 0 to 1,000,000.'),
  maxPercent: wholeNumber(1, 100, 'Enter a whole percentage from 1 to 100.'),
  signupBonus: wholeNumber(0, 1_000_000, 'Enter a whole number of points from 0 to 1,000,000.'),
  reviewBonus: wholeNumber(0, 1_000_000, 'Enter a whole number of points from 0 to 1,000,000.'),
}

// ---- shapes the browser sends ----

export function validateRewardAdjustment(body) {
  const errors = {}
  if (!Number.isInteger(body.points) || body.points === 0 || Math.abs(body.points) > 1_000_000) errors.points = ['Enter a whole number of points other than 0 (negative takes points away).']
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (note.length < 1 || note.length > 255) errors.note = ['Say why the balance changes (up to 255 characters).']
  return Object.keys(errors).length > 0 ? { errors } : { values: { points: body.points, note } }
}

const CURRENCY_CODE = /^[A-Z]{3}$/
/** A display currency (every field on create; only the sent ones on update; the code never changes). */
export function validateCurrency(body, { partial }) {
  const errors = {}
  const values = {}
  const need = (key) => !partial || body[key] !== undefined
  if (!partial) {
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
    if (CURRENCY_CODE.test(code)) values.code = code
    else errors.code = ['Enter the 3-letter ISO 4217 code, like BDT or EUR.']
  } else if (body.code !== undefined) errors.code = ["A currency's code can't change; add a new one instead."]
  if (need('symbol')) {
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : ''
    if (symbol && [...symbol].length <= 5) values.symbol = symbol
    else errors.symbol = ['Enter a symbol of up to 5 characters, like ৳ or €.']
  }
  if (need('rate')) {
    if (typeof body.rate === 'number' && Number.isFinite(body.rate) && body.rate >= 0 && body.rate <= 1_000_000_000 && decimals(body.rate, 8)) values.rate = body.rate
    else errors.rate = ['Enter how many units make 1 USD (0 or more, at most 8 decimals).']
  }
  if (need('decimals')) {
    if (Number.isInteger(body.decimals) && body.decimals >= 0 && body.decimals <= 3) values.decimals = body.decimals
    else errors.decimals = ['Choose 0 to 3 decimals.']
  }
  if (need('enabled')) {
    if (typeof body.enabled === 'boolean') values.enabled = body.enabled
    else errors.enabled = ['Choose whether shoppers can pick it.']
  }
  if (partial && Object.keys(values).length === 0 && Object.keys(errors).length === 0) errors.rate = ['Change at least one field.']
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

export function validateCurrencyOrder(body) {
  const ids = body.ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every((id) => Number.isInteger(id) && id > 0) || new Set(ids).size !== ids.length) {
    return { errors: { ids: ['Send every currency once, in the new order.'] } }
  }
  return { values: { ids } }
}

/** ?limit&skip for the points history. */
function pageParams(url) {
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 100)
  const skip = Math.max(Number.parseInt(url.searchParams.get('skip') ?? '0', 10) || 0, 0)
  return { limit, skip }
}

/** ?from&to&groupBy&limit for the reports: well-formed values only. */
function reportParams(url) {
  const params = new URLSearchParams()
  for (const key of ['from', 'to']) if (isDay(url.searchParams.get(key))) params.set(key, url.searchParams.get(key))
  const groupBy = url.searchParams.get('groupBy')
  if (['day', 'week', 'month'].includes(groupBy)) params.set('group_by', groupBy)
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
  if (limit >= 1 && limit <= 50) params.set('limit', String(limit))
  return params
}

// ---- the routes ----

const PHASE11_ROUTES = {
  'GET customers/:id/wishlist': live(async (ctx) => fromLaravel(await laravelPhase11Data.customerWishlist(ctx.token, ctx.id, ctx.request))),
  'GET customers/:id/rewards': live(async (ctx) => fromLaravel(await laravelPhase11Data.customerRewards(ctx.token, ctx.id, pageParams(ctx.url), ctx.request))),
  'POST customers/:id/rewards/adjust': live(async (ctx) => {
    const { values, errors } = validateRewardAdjustment(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase11Data.adjustRewards(ctx.token, ctx.id, values, ctx.request), 200)
  }),

  'GET reports/wishlist': live(async (ctx) => fromLaravel(await laravelPhase11Data.wishlistReport(ctx.token, reportParams(ctx.url), ctx.request))),
  'GET reports/rewards': live(async (ctx) => fromLaravel(await laravelPhase11Data.rewardsReport(ctx.token, reportParams(ctx.url), ctx.request))),

  'POST products/:id/duplicate': live(async (ctx) => fromLaravel(await laravelPhase11Data.duplicateProduct(ctx.token, ctx.id, ctx.request), 201)),

  'GET currencies': live(async (ctx) => fromLaravel(await laravelPhase11Data.listCurrencies(ctx.token, ctx.request))),
  'POST currencies': live(async (ctx) => {
    const { values, errors } = validateCurrency(await readBody(ctx.request), { partial: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase11Data.createCurrency(ctx.token, values, ctx.request), 201)
  }),
  'PATCH currencies/:id': live(async (ctx) => {
    const { values, errors } = validateCurrency(await readBody(ctx.request), { partial: true })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase11Data.updateCurrency(ctx.token, ctx.id, values, ctx.request))
  }),
  'POST currencies/reorder': live(async (ctx) => {
    const { values, errors } = validateCurrencyOrder(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase11Data.reorderCurrencies(ctx.token, values.ids, ctx.request))
  }),
}

const REPORTS = ['wishlist', 'rewards']

/**
 * The phase 11 routes in adminApi.js's matcher: { route, id } for one of
 * them, null for a malformed address of theirs (404), undefined when not theirs.
 */
export function matchPhase11Route(method, segments) {
  const [first, second, third, fourth, ...rest] = segments
  if (first === 'customers' && (third === 'wishlist' || third === 'rewards')) {
    if (!isId(second) || rest.length > 0) return null
    if (fourth === undefined) return { route: PHASE11_ROUTES[`${method} customers/:id/${third}`], id: second }
    return third === 'rewards' && fourth === 'adjust' ? { route: PHASE11_ROUTES[`${method} customers/:id/rewards/adjust`], id: second } : null
  }
  if (first === 'products' && third === 'duplicate') {
    if (!isId(second) || fourth !== undefined) return null
    return { route: PHASE11_ROUTES[`${method} products/:id/duplicate`], id: second }
  }
  if (first === 'reports' && REPORTS.includes(second)) return third === undefined ? { route: PHASE11_ROUTES[`${method} reports/${second}`] } : null
  if (first === 'currencies') {
    if (third !== undefined) return null
    if (second === undefined) return { route: PHASE11_ROUTES[`${method} currencies`] }
    if (second === 'reorder') return { route: PHASE11_ROUTES[`${method} currencies/reorder`] }
    return isId(second) ? { route: PHASE11_ROUTES[`${method} currencies/:id`], id: second } : null
  }
  return undefined
}
