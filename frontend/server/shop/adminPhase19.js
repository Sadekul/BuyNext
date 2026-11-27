import { laravel } from '../http.js'
import { failed } from './adminSystem.js'
import { camelPath } from './laravel.js'

/*
 * Phase 19 admin data from BuyNest's Laravel API (docs/backend/PHASE19_CONTRACT.md
 * §1 "API" → Admin): the welcome coupon's settings, its offer preview and
 * stats, the list of welcome codes issued, and the new coupon fields
 * (source, issued_to_email, first_order_only). Only listed fields go either
 * way; snake_case becomes camelCase, money strings numbers.
 * Every call resolves to { ok: true, status, data } or { ok: false, status, body }.
 */

export const WELCOME_TRIGGERS = ['signup', 'newsletter']
export const WELCOME_TYPES = ['percent', 'fixed']
export const WELCOME_CODE_STATUSES = ['active', 'used', 'expired']
export const COUPON_SOURCES = ['staff', 'welcome']

const str = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)
const short = (value, max) => str(value)?.slice(0, max) ?? null
const money = (value) => (value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null)
const int = (value) => (Number.isInteger(value) ? value : typeof value === 'string' && /^\d{1,12}$/.test(value) ? Number(value) : null)
const count = (value) => int(value) ?? 0
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null)
const listOf = (data) => (Array.isArray(data?.data) ? data.data : [])
const cents = (value) => (typeof value === 'number' ? value.toFixed(2) : value)
// The settings' keys, with or without the Settings service's "welcome_coupon_" prefix.
const setting = (raw, key) => (raw[`welcome_coupon_${key}`] !== undefined ? raw[`welcome_coupon_${key}`] : raw[key])

// ---- 422 field names: the API's → the admin's ----

const FIELD_NAMES = {
  welcome_coupon_enabled: 'enabled',
  welcome_coupon_triggers: 'triggers',
  welcome_coupon_type: 'type',
  welcome_coupon_value: 'value',
  welcome_coupon_min_subtotal: 'minSubtotal',
  welcome_coupon_valid_days: 'validDays',
  welcome_coupon_first_order_only: 'firstOrderOnly',
}
export const fieldName = (field) => FIELD_NAMES[field] ?? (/^(welcome_coupon_)?triggers\.\d+$/.test(field) ? 'triggers' : camelPath(field))
const fail = (result) => failed(result, fieldName)
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : fail(result))
const call = (path, token, request, options = {}) => laravel(`/api/admin/v1${path}`, { token, request, ...options })

// ---- coupons: the phase 19 fields of the admin coupon resource ----

/** A coupon's phase 19 fields. Old answers (before phase 19): a staff coupon, for everyone, any order. */
export function couponPhase19(raw = {}) {
  return {
    source: COUPON_SOURCES.includes(raw.source) ? raw.source : 'staff',
    issuedToEmail: short(raw.issued_to_email, 191),
    firstOrderOnly: raw.first_order_only === true,
  }
}

// ---- the welcome coupon ----

/** The saved settings (the Settings service's welcome_coupon group). */
export function welcomeSettings(raw) {
  const data = objectOf(raw) ?? {}
  const triggers = setting(data, 'triggers')
  const type = setting(data, 'type')
  return {
    enabled: setting(data, 'enabled') === true,
    triggers: Array.isArray(triggers) ? WELCOME_TRIGGERS.filter((trigger) => triggers.includes(trigger)) : [...WELCOME_TRIGGERS],
    type: WELCOME_TYPES.includes(type) ? type : 'percent',
    value: money(setting(data, 'value')) ?? 0,
    minSubtotal: money(setting(data, 'min_subtotal')),
    validDays: int(setting(data, 'valid_days')) ?? 30,
    firstOrderOnly: setting(data, 'first_order_only') !== false,
  }
}

/** The offer as shoppers see it (WelcomeCoupons::offer(), or the admin's preview while off). */
export function welcomeOffer(raw) {
  const data = objectOf(raw)
  if (!data) return null
  const triggers = Array.isArray(data.triggers) ? WELCOME_TRIGGERS.filter((trigger) => data.triggers.includes(trigger)) : []
  return {
    type: WELCOME_TYPES.includes(data.type) ? data.type : 'percent',
    value: money(data.value) ?? 0,
    // Already in the store currency and translated: "10% off", "৳100 off".
    label: short(data.label, 60),
    // Formatted ("৳500") or null.
    minSubtotal: short(typeof data.min_subtotal === 'number' ? String(data.min_subtotal) : data.min_subtotal, 40),
    validDays: int(data.valid_days),
    firstOrderOnly: data.first_order_only === true,
    triggers,
  }
}

export function welcomeStats(raw) {
  const data = objectOf(raw) ?? {}
  return { issued: count(data.issued), used: count(data.used), active: count(data.active), expired: count(data.expired) }
}

/** GET/PUT marketing/welcome-coupon → { settings, offer, stats }. */
export function welcomeCoupon(raw) {
  const data = objectOf(raw) ?? {}
  return { settings: welcomeSettings(data.settings), offer: welcomeOffer(data.offer), stats: welcomeStats(data.stats) }
}

/** One welcome code issued (newest first in the list). */
export function welcomeCode(raw = {}) {
  const customer = objectOf(raw.customer)
  const order = raw.used_on_order
  return {
    // The coupon's id (its page in the admin), or null.
    id: int(raw.id),
    code: str(raw.code),
    email: short(raw.email, 191),
    trigger: WELCOME_TRIGGERS.includes(raw.trigger) ? raw.trigger : null,
    customer: customer && int(customer.id) ? { id: int(customer.id), name: short(customer.name, 120) ?? '' } : null,
    issuedAt: str(raw.issued_at),
    expiresAt: str(raw.expires_at),
    status: WELCOME_CODE_STATUSES.includes(raw.status) ? raw.status : 'active',
    // The order's number (BN-100001); a bare id is passed on as text.
    usedOnOrder: typeof order === 'number' && Number.isInteger(order) ? String(order) : short(order, 40),
  }
}

// Admin field → the Settings service's key.
const SETTING_KEYS = {
  enabled: 'welcome_coupon_enabled',
  triggers: 'welcome_coupon_triggers',
  type: 'welcome_coupon_type',
  value: 'welcome_coupon_value',
  minSubtotal: 'welcome_coupon_min_subtotal',
  validDays: 'welcome_coupon_valid_days',
  firstOrderOnly: 'welcome_coupon_first_order_only',
}

/**
 * The admin's settings (already checked) → the API's body, under the
 * Settings service's prefixed keys. The value and the minimum go as
 * 2-decimal strings ("10.00"), the minimum null for none, as the API stores them.
 */
export function toWelcomeBody(values) {
  const body = {}
  for (const [field, value] of Object.entries(values)) {
    if (!SETTING_KEYS[field]) continue
    if (field === 'value') body[SETTING_KEYS[field]] = cents(value)
    else if (field === 'minSubtotal') body[SETTING_KEYS[field]] = value === null ? null : cents(value)
    else body[SETTING_KEYS[field]] = value
  }
  return body
}

/** ?page&per_page from the admin's limit/skip, plus any filters that have a value. */
function listParams({ limit = 20, skip = 0, ...filters }) {
  const params = new URLSearchParams({ page: String(Math.floor(skip / limit) + 1), per_page: String(limit) })
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  return params
}

// ---- the calls ----

export const laravelPhase19Data = {
  async welcomeCoupon(token, request) {
    return answer(await call('/marketing/welcome-coupon', token, request), [200], (data) => ({ ...welcomeCoupon(data?.data ?? data), live: true }))
  },
  async updateWelcomeCoupon(token, values, request) {
    const result = await call('/marketing/welcome-coupon', token, request, { method: 'PUT', body: toWelcomeBody(values) })
    return answer(result, [200], (data) => ({ ...welcomeCoupon(data?.data ?? data), live: true }))
  },
  /** filters: { q, status, limit, skip } → { codes, total, limit, skip }. */
  async welcomeCodes(token, { q, limit, skip, ...filters }, request) {
    const result = await call(`/marketing/welcome-coupon/codes?${listParams({ ...filters, search: q, limit, skip })}`, token, request)
    return answer(result, [200], (data) => ({
      codes: listOf(data).map(welcomeCode).filter((entry) => entry.code),
      total: int(data?.meta?.total) ?? listOf(data).length,
      limit,
      skip,
      live: true,
    }))
  },
}
