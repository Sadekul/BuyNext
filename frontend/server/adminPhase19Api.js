import { json, readBody } from './http.js'
import { COUPON_SOURCES, WELCOME_CODE_STATUSES, WELCOME_TRIGGERS, WELCOME_TYPES, laravelPhase19Data } from './shop/adminPhase19.js'

/*
 * Phase 19 admin routes and rules (docs/backend/PHASE19_CONTRACT.md §1 "API"
 * → Admin): the welcome coupon a new customer gets by email. BuyNest's
 * Laravel API only. Matched by adminApi.js before its own routes, so the
 * admin session check there runs first; the API checks the role's
 * permission (the coupon permissions: coupons.view to read, coupons.edit to
 * change) and answers 403 { code: "permission_denied", permission }, passed
 * on unchanged.
 *
 *   GET    /api/admin/marketing/welcome-coupon         → { settings: { enabled, triggers: [signup|newsletter], type: percent|fixed, value,
 *                                                        minSubtotal|null, validDays, firstOrderOnly },
 *                                                        offer: { type, value, label ("10% off"), minSubtotal ("৳500"|null), validDays,
 *                                                        firstOrderOnly, triggers } (a preview, even while off) | null,
 *                                                        stats: { issued, used, active, expired } }
 *   PUT    /api/admin/marketing/welcome-coupon         (any of the settings) → the same
 *   GET    /api/admin/marketing/welcome-coupon/codes?status=active|used|expired&q&limit&skip
 *                                                      → { codes: [{ id (the coupon's), code, email, trigger, customer: { id, name }|null, issuedAt, expiresAt,
 *                                                        status, usedOnOrder: "BN-…"|null }], total } (newest first)
 *
 * The rest rides on the coupon routes (adminApi.js):
 *   GET coupons?source=staff|welcome                   the list's tabs (no source: all, as before)
 *   coupons                                            + source (staff | welcome), issuedToEmail, firstOrderOnly (editable)
 */

const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const LIVE_ONLY = 'This needs the BuyNest backend; the demo data has no welcome coupon.'
const live = (handler) => (ctx) => (realData() ? handler(ctx) : json({ message: LIVE_ONLY }, 404))
const fromLaravel = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))
const invalid = (errors) => json({ message: 'Please check the highlighted fields.', errors }, 422)

const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)
export const MAX_FIXED = 100_000
export const MAX_MINIMUM = 1_000_000
const MAX_PAGE = 100

/** ?source=staff|welcome of the coupon list → the API's filter (only a known source; none = all). */
export const couponSourceFilter = (url) => {
  const source = url.searchParams.get('source')
  return COUPON_SOURCES.includes(source) ? { source } : {}
}

/** The coupon form's phase 19 field: "First order only" (a staff coupon's option too). */
export function checkCouponPhase19(body, values, errors) {
  if (body.firstOrderOnly === undefined) return
  if (typeof body.firstOrderOnly === 'boolean') values.firstOrderOnly = body.firstOrderOnly
  else errors.firstOrderOnly = ['Choose whether the code is for a first order only.']
}

/**
 * The welcome coupon's settings (partial): the same rules and words as the
 * API, checked here first. The value's range depends on the type when both
 * are sent (percent 1–90 whole, fixed above 0 and at most 100,000).
 */
export function validateWelcomeCoupon(body) {
  const errors = {}
  const values = {}
  if (body.enabled !== undefined) {
    if (typeof body.enabled === 'boolean') values.enabled = body.enabled
    else errors.enabled = ['Choose on or off.']
  }
  if (body.triggers !== undefined) {
    const triggers = Array.isArray(body.triggers) ? body.triggers : null
    if (!triggers || triggers.length === 0 || !triggers.every((trigger) => WELCOME_TRIGGERS.includes(trigger))) errors.triggers = ['Choose at least one way to earn the code.']
    else values.triggers = WELCOME_TRIGGERS.filter((trigger) => triggers.includes(trigger))
  }
  if (body.type !== undefined) {
    if (WELCOME_TYPES.includes(body.type)) values.type = body.type
    else errors.type = ['Choose a percentage or a fixed amount.']
  }
  if (body.value !== undefined) {
    const value = body.value
    const type = values.type ?? (errors.type ? null : undefined)
    if (type === 'percent') {
      if (Number.isInteger(value) && value >= 1 && value <= 90) values.value = value
      else errors.value = ['A percentage discount is between 1 and 90.']
    } else if (type === 'fixed') {
      if (isNumber(value) && value > 0 && value <= MAX_FIXED && hasCents(value)) values.value = value
      else errors.value = ['A fixed discount is more than 0 and at most 100,000, with at most 2 decimals.']
    } else if (type === undefined) {
      if (isNumber(value) && value > 0 && value <= MAX_FIXED && hasCents(value)) values.value = value
      else errors.value = ['Enter a discount above 0.']
    }
  }
  if (body.minSubtotal !== undefined) {
    if (body.minSubtotal === null || body.minSubtotal === '') values.minSubtotal = null
    else if (isNumber(body.minSubtotal) && body.minSubtotal > 0 && body.minSubtotal <= MAX_MINIMUM && hasCents(body.minSubtotal)) values.minSubtotal = body.minSubtotal
    else errors.minSubtotal = ['Enter a minimum order above 0 with at most 2 decimals, or leave it empty.']
  }
  if (body.validDays !== undefined) {
    if (Number.isInteger(body.validDays) && body.validDays >= 1 && body.validDays <= 365) values.validDays = body.validDays
    else errors.validDays = ['A code is valid for 1 to 365 days.']
  }
  if (body.firstOrderOnly !== undefined) {
    if (typeof body.firstOrderOnly === 'boolean') values.firstOrderOnly = body.firstOrderOnly
    else errors.firstOrderOnly = ['Choose whether the code is for a first order only.']
  }
  if (Object.keys(values).length === 0 && Object.keys(errors).length === 0) errors.enabled = ['Change at least one setting.']
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

function codeFilters(url) {
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), MAX_PAGE)
  const skip = Math.max(Number.parseInt(url.searchParams.get('skip') ?? '0', 10) || 0, 0)
  const status = url.searchParams.get('status')
  return {
    q: url.searchParams.get('q')?.trim().slice(0, 100) || undefined,
    status: WELCOME_CODE_STATUSES.includes(status) ? status : undefined,
    limit,
    skip,
  }
}

// ---- the routes ----

const PHASE19_ROUTES = {
  'GET marketing/welcome-coupon': live(async (ctx) => fromLaravel(await laravelPhase19Data.welcomeCoupon(ctx.token, ctx.request))),
  'PUT marketing/welcome-coupon': live(async (ctx) => {
    const { values, errors } = validateWelcomeCoupon(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase19Data.updateWelcomeCoupon(ctx.token, values, ctx.request))
  }),
  'GET marketing/welcome-coupon/codes': live(async (ctx) => fromLaravel(await laravelPhase19Data.welcomeCodes(ctx.token, codeFilters(ctx.url), ctx.request))),
}

/**
 * The phase 19 routes in adminApi.js's matcher: { route } for one of them,
 * null for a malformed address of theirs (404), undefined when not theirs.
 */
export function matchPhase19Route(method, segments) {
  const [first, second, third, ...rest] = segments
  if (first !== 'marketing') return undefined
  if (second !== 'welcome-coupon' || rest.length > 0) return null
  if (third === undefined) return { route: PHASE19_ROUTES[`${method} marketing/welcome-coupon`] }
  if (third === 'codes') return { route: PHASE19_ROUTES[`${method} marketing/welcome-coupon/codes`] }
  return null
}
