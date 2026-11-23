import { json, laravelFile, readBody } from './http.js'
import { CSV_REPORTS, REPORTS, SETTINGS_GROUPS, failed, laravelSystemData } from './shop/adminSystem.js'
// Phase 11 §4: Settings → Reward points.
import { REWARD_SETTING_RULES } from './adminPhase11Api.js'
// Phase 13: the Bangla texts of pages and home blocks; Settings → General's language settings.
import { LANGUAGE_SETTING_RULES, checkBangla } from './adminPhase13Api.js'

/*
 * Phase 4 admin routes (docs/backend/PHASE4_CONTRACT.md), Laravel only:
 * admin users, roles, the audit log, CMS pages, the home page, reports, and
 * settings. Merged into adminApi.js's route table, so the admin session
 * check there runs first; the API then checks the role's permission on every
 * call and answers 403 { code: "permission_denied", permission } when it's
 * missing, passed on unchanged.
 *
 * Bodies are allow-listed and checked for shape here (Laravel-style 422s);
 * the API has the final word on the rules (one active Owner, system roles…).
 *
 *   GET    /api/admin/admins?q&limit&skip           → { admins, total, limit, skip }
 *   POST   /api/admin/admins                        { name, email, roleId, isActive?, password } → 201 { admin }
 *   GET    /api/admin/admins/:id
 *   PATCH  /api/admin/admins/:id                    { name?, email?, roleId?, isActive? } → { admin }
 *   POST   /api/admin/admins/:id/reset-password     { password } → { ok, message }
 *   GET    /api/admin/roles                         → { roles: [{ id, name, description, permissions, isSystem, adminCount }] }
 *   POST   /api/admin/roles                         { name, description?, permissions } → 201 { role }
 *   PATCH  /api/admin/roles/:id                     → { role }
 *   DELETE /api/admin/roles/:id                     → { deleted: true }
 *   GET    /api/admin/permissions                   → { groups: [{ label, permissions: [{ key, label }] }] }
 *   GET    /api/admin/audit?adminId&action&subjectType&from&to&limit&skip → { entries, total, limit, skip }
 *   GET    /api/admin/pages?q&limit&skip            → { pages, total, limit, skip }
 *   POST   /api/admin/pages                         { slug, title, body, metaTitle?, metaDescription?, isPublished? } → 201 { page }
 *   GET    /api/admin/pages/:id
 *   PATCH  /api/admin/pages/:id                     → { page } (body comes back sanitized)
 *   DELETE /api/admin/pages/:id
 *   GET    /api/admin/home                          → { hero, banners, featuredProductIds, featuredProducts }
 *   PUT    /api/admin/home                          { hero, banners, featuredProductIds } → { home }
 *   GET    /api/admin/reports/sales|products|customers|coupons|low-stock?from&to&groupBy&limit
 *   GET    /api/admin/reports/sales.csv|products.csv  → the CSV file, with the API's Content-Type and Content-Disposition
 *   GET    /api/admin/settings                      → { general, shipping, tax, checkout, inventory, catalog, returns, security (phase 9) }
 *   PATCH  /api/admin/settings                      { group: { key: value } } → all settings
 */

const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const fromLaravel = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))
const invalid = (errors) => json({ message: 'Please check the highlighted fields.', errors }, 422)
const LIVE_ONLY = 'This needs the BuyNest backend; the demo data has no admin users, roles, content, reports, or settings.'
const liveOnly = () => json({ message: LIVE_ONLY }, 404)

const MAX_PAGE = 100
function pageParams(url) {
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), MAX_PAGE)
  const skip = Math.max(Number.parseInt(url.searchParams.get('skip') ?? '0', 10) || 0, 0)
  return { limit, skip }
}
const search = (url) => url.searchParams.get('q')?.trim().slice(0, 100) || undefined
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && !Number.isNaN(Date.parse(value))
const dayParam = (url, key) => (isDay(url.searchParams.get(key)) ? url.searchParams.get(key) : undefined)

// ---- rules (Laravel-style errors: { field: [message] }) ----

const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const isMoney = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000 && hasCents(value)
const isEmail = (value) => typeof value === 'string' && value.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
const isText = (value, { min = 0, max }) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max
// Links on the home page: a path on the store, or an http(s) address.
const isLink = (value) => typeof value === 'string' && value.length <= 500 && (value === '' || /^\/(?!\/)/.test(value) || /^https?:\/\/[^\s]+$/i.test(value))
export const isStrongPassword = (value) => typeof value === 'string' && value.length >= 12 && value.length <= 200 && /[A-Za-z]/.test(value) && /\d/.test(value)
const PASSWORD_RULE = 'Use at least 12 characters, with letters and numbers.'

/** Runs `rules` over the fields present in `body`; `required` fields must be there. */
function check(body, rules, required = []) {
  const errors = {}
  const values = {}
  for (const [field, rule] of Object.entries(rules)) {
    if (body[field] === undefined) {
      if (required.includes(field)) errors[field] = [rule(undefined) ?? 'This field is required.']
      continue
    }
    const problem = rule(body[field])
    if (problem) errors[field] = [problem]
    else values[field] = typeof body[field] === 'string' ? body[field].trim() : body[field]
  }
  return { errors, values }
}
const result = ({ errors, values }) => (Object.keys(errors).length > 0 ? { errors } : { values })
const nothingChanged = (values, errors, field) => (Object.keys(values).length === 0 && Object.keys(errors).length === 0 ? { [field]: ['Change at least one field.'] } : errors)

const ADMIN_RULES = {
  name: (value) => (isText(value, { min: 1, max: 100 }) ? null : 'Enter a name of up to 100 characters.'),
  email: (value) => (isEmail(value) ? null : 'Enter a valid email address.'),
  roleId: (value) => (Number.isInteger(value) && value > 0 ? null : 'Choose a role.'),
  isActive: (value) => (typeof value === 'boolean' ? null : 'Choose whether the account is active.'),
}
export function validateAdminUser(body, { partial }) {
  const rules = partial ? ADMIN_RULES : { ...ADMIN_RULES, password: (value) => (isStrongPassword(value) ? null : PASSWORD_RULE) }
  const { errors, values } = check(body, rules, partial ? [] : ['name', 'email', 'roleId', 'password'])
  if (values.password !== undefined) values.password = body.password // never trimmed
  if (values.email) values.email = values.email.toLowerCase()
  return result({ errors: partial ? nothingChanged(values, errors, 'name') : errors, values })
}

const PERMISSION_KEY = /^[a-z_]{1,40}\.[a-z_]{1,40}$/
const ROLE_RULES = {
  name: (value) => (isText(value, { min: 2, max: 60 }) ? null : 'Enter a name of 2 to 60 characters.'),
  description: (value) => (value === null || isText(value, { max: 255 }) ? null : 'Keep the description under 255 characters.'),
  permissions: (value) => (Array.isArray(value) && value.length <= 100 && value.every((key) => typeof key === 'string' && PERMISSION_KEY.test(key)) ? null : 'Choose the permissions from the list.'),
}
export function validateRole(body, { partial }) {
  const { errors, values } = check(body, ROLE_RULES, partial ? [] : ['name', 'permissions'])
  if (values.permissions) values.permissions = [...new Set(values.permissions)]
  if (values.description === '') values.description = null
  return result({ errors: partial ? nothingChanged(values, errors, 'name') : errors, values })
}

const PAGE_RULES = {
  slug: (value) => (typeof value === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && value.length <= 80 ? null : 'Use lower-case letters, digits, and dashes (up to 80).'),
  title: (value) => (isText(value, { min: 1, max: 200 }) ? null : 'Enter a title of up to 200 characters.'),
  body: (value) => (typeof value === 'string' && value.length <= 100_000 ? null : 'Keep the page under 100,000 characters.'),
  metaTitle: (value) => (value === null || isText(value, { max: 255 }) ? null : 'Keep the meta title under 255 characters.'),
  metaDescription: (value) => (value === null || isText(value, { max: 500 }) ? null : 'Keep the meta description under 500 characters.'),
  isPublished: (value) => (typeof value === 'boolean' ? null : 'Choose whether the page is published.'),
}
export function validatePage(body, { partial }) {
  const { errors, values } = check(body, PAGE_RULES, partial ? [] : ['slug', 'title', 'body'])
  if (values.body !== undefined) values.body = body.body // HTML as typed; the API sanitizes it
  for (const field of ['metaTitle', 'metaDescription']) if (values[field] === '') values[field] = null
  // Phase 13: bn: { title, body, metaTitle, metaDescription } (optional; '' = not translated).
  if (body.bn !== undefined) {
    const bangla = checkBangla(body.bn, 'page')
    Object.assign(errors, bangla.errors)
    if (Object.keys(bangla.values).length > 0) values.bn = bangla.values
  }
  return result({ errors: partial ? nothingChanged(values, errors, 'title') : errors, values })
}

export const BANNER_TONES = ['navy', 'emerald', 'amber', 'rose']
const MAX_BANNERS = 10
const MAX_FEATURED = 8

/** PUT /home: the whole home content, every field checked; errors by path ("banners.0.title"). */
export function validateHome(body) {
  const errors = {}
  const textAt = (path, value, max, { min = 0 } = {}) => {
    if (!isText(value ?? '', { min, max })) errors[path] = [min > 0 ? `Enter up to ${max} characters.` : `Keep this under ${max} characters.`]
    return typeof value === 'string' ? value.trim() : ''
  }
  const linkAt = (path, value) => {
    if (!isLink(value ?? '')) errors[path] = ['Use a store path like /products or an https:// address.']
    return typeof value === 'string' ? value.trim() : ''
  }
  const ctaAt = (path, value, { optional = false } = {}) => {
    if (optional && (!value || typeof value !== 'object' || (!value.label && !value.url))) return null
    const cta = { label: textAt(`${path}.label`, value?.label, 40, { min: 1 }), url: linkAt(`${path}.url`, value?.url) }
    if (!cta.url && !errors[`${path}.url`]) errors[`${path}.url`] = ['Enter where the button goes.']
    return cta
  }

  const raw = body.hero && typeof body.hero === 'object' ? body.hero : {}
  const highlights = Array.isArray(raw.highlights) ? raw.highlights.slice(0, 3) : []
  const hero = {
    eyebrow: textAt('hero.eyebrow', raw.eyebrow, 60),
    title: textAt('hero.title', raw.title, 120, { min: 1 }),
    description: textAt('hero.description', raw.description, 300),
    primaryCta: ctaAt('hero.primaryCta', raw.primaryCta),
    secondaryCta: ctaAt('hero.secondaryCta', raw.secondaryCta, { optional: true }),
    imageUrl: linkAt('hero.imageUrl', raw.imageUrl),
    imageAlt: textAt('hero.imageAlt', raw.imageAlt, 200),
    highlights: highlights.map((value, index) => textAt(`hero.highlights.${index}`, value, 80)).filter(Boolean),
  }
  // Phase 13: the hero's and each banner's Bangla texts (optional).
  const banglaAt = (path, value) => {
    if (value === undefined) return undefined
    const checked = checkBangla(value, path.startsWith('hero') ? 'hero' : 'banner', path)
    Object.assign(errors, checked.errors)
    return checked.values
  }
  const heroBn = banglaAt('hero.bn', raw.bn)
  if (heroBn) hero.bn = heroBn
  if (hero.imageUrl && !hero.imageAlt && !errors['hero.imageAlt']) errors['hero.imageAlt'] = ['Describe the image for people who cannot see it.']

  if (body.banners !== undefined && (!Array.isArray(body.banners) || body.banners.length > MAX_BANNERS)) errors.banners = [`Use up to ${MAX_BANNERS} banners.`]
  const banners = (Array.isArray(body.banners) ? body.banners.slice(0, MAX_BANNERS) : []).map((banner, index) => {
    const path = `banners.${index}`
    const id = banner?.id
    const item = {
      id: Number.isInteger(id) || (typeof id === 'string' && /^[a-z0-9-]{1,60}$/.test(id)) ? id : null,
      eyebrow: textAt(`${path}.eyebrow`, banner?.eyebrow, 60),
      title: textAt(`${path}.title`, banner?.title, 120, { min: 1 }),
      description: textAt(`${path}.description`, banner?.description, 300),
      cta: ctaAt(`${path}.cta`, banner?.cta),
      imageUrl: linkAt(`${path}.imageUrl`, banner?.imageUrl),
      imageAlt: textAt(`${path}.imageAlt`, banner?.imageAlt, 200),
      tone: BANNER_TONES.includes(banner?.tone) ? banner.tone : null,
      isActive: banner?.isActive !== false,
    }
    const bn = banglaAt(`${path}.bn`, banner?.bn)
    if (bn) item.bn = bn
    if (!item.tone) errors[`${path}.tone`] = ['Choose a color.']
    if (item.imageUrl && !item.imageAlt && !errors[`${path}.imageAlt`]) errors[`${path}.imageAlt`] = ['Describe the image for people who cannot see it.']
    return item
  })

  const ids = body.featuredProductIds
  if (ids !== undefined && (!Array.isArray(ids) || ids.length > MAX_FEATURED || !ids.every((id) => Number.isInteger(id) && id > 0))) {
    errors.featuredProductIds = [`Choose up to ${MAX_FEATURED} products.`]
  }
  const featuredProductIds = Array.isArray(ids) ? [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, MAX_FEATURED) : []
  return Object.keys(errors).length > 0 ? { errors } : { values: { hero, banners, featuredProductIds } }
}

const SHIPPING_METHODS = ['standard', 'express', 'nextDay']
// Phase 12: + sslcommerz (bKash, Nagad, cards).
const PAYMENT_METHODS = ['card', 'paypal', 'sslcommerz', 'cod']
const someOf = (allowed, message) => (value) => (Array.isArray(value) && value.length > 0 && value.every((entry) => allowed.includes(entry)) ? null : message)
const isBoolean = (message) => (value) => (typeof value === 'boolean' ? null : message)
const moneyRule = (value) => (isMoney(value) ? null : 'Enter an amount of 0 or more, with at most 2 decimals.')
const SETTING_RULES = {
  general: {
    storeName: (value) => (isText(value, { min: 1, max: 100 }) ? null : 'Enter a store name of up to 100 characters.'),
    supportEmail: (value) => (isEmail(value) ? null : 'Enter a valid email address.'),
    supportPhone: (value) => (isText(value, { max: 40 }) && /^[\d\s()+.-]*$/.test(value) ? null : 'Enter a phone number (digits, spaces, + ( ) - .).'),
    address: (value) => (isText(value, { max: 500 }) ? null : 'Keep the address under 500 characters.'),
    // Phase 13.
    ...LANGUAGE_SETTING_RULES,
  },
  shipping: {
    standardPrice: moneyRule,
    freeShippingThreshold: moneyRule,
    expressPrice: moneyRule,
    nextDayPrice: moneyRule,
    enabledMethods: someOf(SHIPPING_METHODS, 'Keep at least one shipping method.'),
    // Phase 10 §4.
    defaultWeightGrams: (value) => (Number.isInteger(value) && value >= 0 && value <= 100_000 ? null : 'Enter a whole number of grams from 0 to 100,000.'),
  },
  tax: {
    taxEnabled: isBoolean('Choose whether tax is charged.'),
    pricesIncludeTax: isBoolean('Choose whether prices include tax.'),
    taxRates: (value) =>
      Array.isArray(value) && value.length <= 250 && value.every((rate) => isText(rate?.country, { min: 1, max: 60 }) && typeof rate.rate === 'number' && rate.rate >= 0 && rate.rate <= 100 && hasCents(rate.rate))
        ? null
        : 'Each rate needs a country and a percentage from 0 to 100 (2 decimals).',
  },
  checkout: {
    allowedCountries: (value) => (Array.isArray(value) && value.length > 0 && value.length <= 250 && value.every((country) => isText(country, { min: 1, max: 60 })) ? null : 'Keep at least one country.'),
    guestCheckout: isBoolean('Choose whether guests can check out.'),
    enabledPaymentMethods: someOf(PAYMENT_METHODS, 'Keep at least one payment method.'),
  },
  inventory: {
    lowStockThreshold: (value) => (Number.isInteger(value) && value >= 0 && value <= 100_000 ? null : 'Enter a whole number from 0 to 100,000.'),
  },
  catalog: {
    reviewsRequireApproval: isBoolean('Choose whether new reviews wait for approval.'),
  },
  returns: {
    returnsEnabled: isBoolean('Choose whether customers can request returns.'),
    returnWindowDays: (value) => (Number.isInteger(value) && value >= 1 && value <= 365 ? null : 'Enter a whole number of days from 1 to 365.'),
    returnReasons: (value) =>
      Array.isArray(value) && value.length >= 1 && value.length <= 20 && value.every((reason) => isText(reason, { min: 1, max: 60 })) && new Set(value.map((reason) => reason.trim().toLowerCase())).size === value.length
        ? null
        : 'Keep 1 to 20 different reasons, each up to 60 characters.',
  },
  // Phase 9: Owner only (the API answers 403 owner_only to anyone else).
  security: {
    requireAdminTwoFactor: isBoolean('Choose whether every admin must use two-step sign-in.'),
  },
  // Phase 10 §2 and §6.
  documents: {
    paperSize: (value) => (['a4', 'letter'].includes(value) ? null : 'Choose A4 or Letter.'),
    attachPdfToEmails: isBoolean('Choose whether invoice emails carry the PDF.'),
  },
  analytics: {
    // "" or null turns statistics off; otherwise a GA4 measurement id (G-ABC123XYZ).
    ga4MeasurementId: (value) => (value === null || value === '' || (typeof value === 'string' && /^G-[A-Z0-9]{4,12}$/.test(value)) ? null : 'Enter a GA4 measurement ID like G-ABC123XYZ, or leave it empty.'),
  },
  // Phase 11 §4.
  rewards: REWARD_SETTING_RULES,
}

/** PATCH /settings: { group: { key: value } }, known groups and keys only; errors as "group.key". */
export function validateSettings(body) {
  const errors = {}
  const values = {}
  for (const [group, groupBody] of Object.entries(body)) {
    if (!SETTINGS_GROUPS[group] || !groupBody || typeof groupBody !== 'object' || Array.isArray(groupBody)) continue
    const checked = check(groupBody, SETTING_RULES[group])
    for (const [key, messages] of Object.entries(checked.errors)) errors[`${group}.${key}`] = messages
    if (Object.keys(checked.values).length > 0) values[group] = checked.values
  }
  if (values.tax?.taxRates) values.tax.taxRates = values.tax.taxRates.map((rate) => ({ country: rate.country.trim(), rate: rate.rate }))
  if (values.returns?.returnReasons) values.returns.returnReasons = values.returns.returnReasons.map((reason) => reason.trim())
  // Phase 10: an empty measurement id turns statistics off.
  if (values.analytics?.ga4MeasurementId === '') values.analytics.ga4MeasurementId = null
  if (values.checkout?.allowedCountries) values.checkout.allowedCountries = [...new Set(values.checkout.allowedCountries.map((country) => country.trim()))]
  if (Object.keys(errors).length === 0 && Object.keys(values).length === 0) errors.settings = ['Change at least one setting.']
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

/** ?from&to&groupBy&limit for the reports: well-formed values only. */
function reportParams(url) {
  const params = new URLSearchParams()
  const from = dayParam(url, 'from')
  const to = dayParam(url, 'to')
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const groupBy = url.searchParams.get('groupBy')
  if (['day', 'week', 'month'].includes(groupBy)) params.set('group_by', groupBy)
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
  if (limit >= 1 && limit <= 50) params.set('limit', String(limit))
  return params
}

// The file name from the API's Content-Disposition, if it's a plain one; else ours.
function downloadName(disposition, report) {
  const name = /filename="?([A-Za-z0-9._-]{1,100})"?/.exec(disposition ?? '')?.[1]
  return name && name.endsWith('.csv') ? name : `buynest-${report}-report.csv`
}

// Every route: the BuyNest backend only, then the shape check, then the API.
const live = (handler) => (ctx) => (realData() ? handler(ctx) : liveOnly())

export const SYSTEM_ROUTES = {
  'GET admins': live(async (ctx) => {
    const status = ['active', 'inactive'].includes(ctx.url.searchParams.get('status')) ? ctx.url.searchParams.get('status') : undefined
    return fromLaravel(await laravelSystemData.listAdmins(ctx.token, { q: search(ctx.url), status, ...pageParams(ctx.url) }, ctx.request))
  }),
  'POST admins': live(async (ctx) => {
    const { values, errors } = validateAdminUser(await readBody(ctx.request), { partial: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSystemData.createAdmin(ctx.token, values, ctx.request), 201)
  }),
  'GET admins/:id': live(async (ctx) => fromLaravel(await laravelSystemData.getAdmin(ctx.token, ctx.id, ctx.request))),
  'PATCH admins/:id': live(async (ctx) => {
    const { values, errors } = validateAdminUser(await readBody(ctx.request), { partial: true })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSystemData.updateAdmin(ctx.token, ctx.id, values, ctx.request))
  }),
  'POST admins/:id/reset-password': live(async (ctx) => {
    const { password } = await readBody(ctx.request)
    if (!isStrongPassword(password)) return invalid({ password: [PASSWORD_RULE] })
    return fromLaravel(await laravelSystemData.resetAdminPassword(ctx.token, ctx.id, { password }, ctx.request))
  }),

  'GET roles': live(async (ctx) => fromLaravel(await laravelSystemData.listRoles(ctx.token, ctx.request))),
  'POST roles': live(async (ctx) => {
    const { values, errors } = validateRole(await readBody(ctx.request), { partial: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSystemData.createRole(ctx.token, values, ctx.request), 201)
  }),
  'PATCH roles/:id': live(async (ctx) => {
    const { values, errors } = validateRole(await readBody(ctx.request), { partial: true })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSystemData.updateRole(ctx.token, ctx.id, values, ctx.request))
  }),
  'DELETE roles/:id': live(async (ctx) => fromLaravel(await laravelSystemData.deleteRole(ctx.token, ctx.id, ctx.request), 200)),
  'GET permissions': live(async (ctx) => fromLaravel(await laravelSystemData.permissions(ctx.token, ctx.request))),

  'GET audit': live(async (ctx) => {
    const { searchParams } = ctx.url
    const action = searchParams.get('action')?.trim()
    const subjectType = searchParams.get('subjectType')?.trim()
    const filters = {
      adminId: /^\d{1,9}$/.test(searchParams.get('adminId') ?? '') ? searchParams.get('adminId') : undefined,
      action: action && /^[a-z_]{1,40}(\.[a-z_]{1,40})?$/.test(action) ? action : undefined,
      subjectType: subjectType && /^[a-z_]{1,40}$/.test(subjectType) ? subjectType : undefined,
      from: dayParam(ctx.url, 'from'),
      to: dayParam(ctx.url, 'to'),
      ...pageParams(ctx.url),
    }
    return fromLaravel(await laravelSystemData.audit(ctx.token, filters, ctx.request))
  }),

  'GET pages': live(async (ctx) => fromLaravel(await laravelSystemData.listPages(ctx.token, { q: search(ctx.url), ...pageParams(ctx.url) }, ctx.request))),
  'POST pages': live(async (ctx) => {
    const { values, errors } = validatePage(await readBody(ctx.request), { partial: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSystemData.createPage(ctx.token, values, ctx.request), 201)
  }),
  'GET pages/:id': live(async (ctx) => fromLaravel(await laravelSystemData.getPage(ctx.token, ctx.id, ctx.request))),
  'PATCH pages/:id': live(async (ctx) => {
    const { values, errors } = validatePage(await readBody(ctx.request), { partial: true })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSystemData.updatePage(ctx.token, ctx.id, values, ctx.request))
  }),
  'DELETE pages/:id': live(async (ctx) => fromLaravel(await laravelSystemData.deletePage(ctx.token, ctx.id, ctx.request), 200)),

  'GET home': live(async (ctx) => fromLaravel(await laravelSystemData.getHome(ctx.token, ctx.request))),
  'PUT home': live(async (ctx) => {
    const { values, errors } = validateHome(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSystemData.updateHome(ctx.token, values, ctx.request))
  }),

  'GET reports/:id': live(async (ctx) => {
    const params = reportParams(ctx.url)
    if (REPORTS.includes(ctx.id)) return fromLaravel(await laravelSystemData.report(ctx.token, ctx.id, params, ctx.request))
    // CSV: the API's file, with its type and a safe download name.
    const report = ctx.id.replace(/\.csv$/, '')
    const file = await laravelFile(`/api/admin/v1/reports/${report}.csv?${params}`, { token: ctx.token, request: ctx.request })
    if (file.text === undefined) return json(failed(file).body, file.status)
    return new Response(file.text, {
      status: 200,
      headers: {
        'Content-Type': file.contentType.startsWith('text/csv') ? file.contentType : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${downloadName(file.disposition, report)}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }),

  'GET settings': live(async (ctx) => fromLaravel(await laravelSystemData.getSettings(ctx.token, ctx.request))),
  'PATCH settings': live(async (ctx) => {
    const { values, errors } = validateSettings(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSystemData.updateSettings(ctx.token, values, ctx.request))
  }),
}

/** Which names a report may have in the URL (reports/sales, reports/sales.csv, …). */
export const isReportName = (value) => REPORTS.includes(value) || CSV_REPORTS.some((report) => value === `${report}.csv`)
