import { json, laravelFile, readBody } from './http.js'
import { failed } from './shop/adminSystem.js'
import { laravelMarketingData } from './shop/adminMarketing.js'

/*
 * Phase 7 admin marketing routes (docs/backend/PHASE7_CONTRACT.md), Laravel
 * only. Reached through adminApi.js (matchMarketingRoute), so the admin
 * session check there runs first; the API then checks the role's permission
 * (price_rules.manage, coupons.view, newsletter.view/send, reports.view,
 * seo.manage) and answers 403 { code: "permission_denied", permission },
 * passed on unchanged.
 *
 *   GET    /api/admin/catalog-rules?q&status&limit&skip → { rules: [rule], total } (status: active | inactive | scheduled | expired)
 *            rule = { id, name, description, isActive, status, startsAt, endsAt, customerGroupIds, categoryIds,
 *                     productIds, action: percent | fixed, amount, priority, stopFurther }
 *   POST   /api/admin/catalog-rules                  (the rule's fields) → 201 { rule }
 *   GET    /api/admin/catalog-rules/:id              → the rule
 *   PATCH  /api/admin/catalog-rules/:id              (any of the fields) → { rule }
 *   DELETE /api/admin/catalog-rules/:id              → { deleted: true }
 *   GET    /api/admin/catalog-rules/:id/preview      → { products: [{ id, name, sku, thumbnail, status, price, oldPrice, newPrice, hasVariants }], total }
 *                                                       (the first 50; this rule alone, groups and dates ignored; total = all matching)
 *
 *   GET    /api/admin/newsletter/subscribers?q&status&source&limit&skip
 *                                                     → { subscribers: [{ id, email, customerId, customerName, status, source,
 *                                                         confirmedAt, unsubscribedAt, createdAt }], total, counts }
 *   GET    /api/admin/newsletter/subscribers/export.csv?(the same filters) → the CSV file
 *   POST   /api/admin/newsletter/subscribers/:id/unsubscribe → { subscriber }
 *   GET    /api/admin/newsletter/campaigns?q&status&limit&skip → { campaigns: [{ id, subject, preheader, body (detail only), status
 *                                                         (draft | sending | sent), recipientCount, sentCount, failedCount, createdByName, sentAt, createdAt }], total }
 *   POST   /api/admin/newsletter/campaigns           { subject, preheader?, body } → 201 { campaign } (body comes back sanitized)
 *   GET    /api/admin/newsletter/campaigns/:id       → the campaign
 *   PATCH  /api/admin/newsletter/campaigns/:id       (any of the fields; drafts only) → { campaign }
 *   DELETE /api/admin/newsletter/campaigns/:id       → { deleted: true } (drafts only)
 *   POST   /api/admin/newsletter/campaigns/:id/test  → { sent: true, email, message } (to the signed-in admin's own email)
 *   POST   /api/admin/newsletter/campaigns/:id/send  → { campaign, message } (drafts only; queued to every subscribed address in batches of 100)
 *
 *   GET    /api/admin/reports/abandoned-carts?q&minAgeHours&maxAgeDays&minSubtotal&sort (newest | oldest | subtotal)&limit&skip
 *                                                     → { carts: [{ customerId, customer: { id, name, email, isActive }, items: [{ productId,
 *                                                         variantId, name, variantLabel, sku, thumbnail, quantity, salePrice, available }],
 *                                                         itemCount, subtotal, updatedAt, ageMinutes, remindedAt, canRemind, remindAvailableAt }], total }
 *   POST   /api/admin/reports/abandoned-carts/:customerId/remind (newsletter.send) → { reminded: true, email, remindedAt, message }
 *                                                       (429 code "too_soon" within 72 hours; 422 cart/customer; 404 no cart)
 *   GET    /api/admin/reports/search-terms?type=top|zero&q&limit&skip (reports.view)
 *                                                     → { terms: [{ id, term, hits, lastResultsCount, redirectUrl, createdAt, updatedAt }], total }
 *   GET    /api/admin/search-terms?q&hasRedirect&limit&skip (seo.manage) → { terms, total }
 *   POST   /api/admin/search-terms                   { term, redirectUrl } → 201 { term }
 *   PATCH  /api/admin/search-terms/:id               { redirectUrl: "/path" | "https://…" | null } → { term }
 *   DELETE /api/admin/search-terms/:id               → { deleted: true }
 */

const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const fromLaravel = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))
const invalid = (errors) => json({ message: 'Please check the highlighted fields.', errors }, 422)
const LIVE_ONLY = 'This needs the BuyNest backend; the demo data has no price rules, newsletter, abandoned carts, or search terms.'
const liveOnly = () => json({ message: LIVE_ONLY }, 404)
const live = (handler) => (ctx) => (realData() ? handler(ctx) : liveOnly())

const MAX_PAGE = 100
function pageParams(url) {
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), MAX_PAGE)
  const skip = Math.max(Number.parseInt(url.searchParams.get('skip') ?? '0', 10) || 0, 0)
  return { limit, skip }
}
const search = (url) => url.searchParams.get('q')?.trim().slice(0, 100) || undefined
const oneOf = (value, allowed) => (allowed.includes(value) ? value : undefined)

// ---- rules (Laravel-style errors: { field: [message] }) ----

const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const isId = (value) => Number.isInteger(value) && value > 0 && value < 1e9
const isMoney = (value, { max = 1_000_000 } = {}) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max && hasCents(value)
const isText = (value, { min = 0, max }) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max
const isDate = (value) => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(value) && !Number.isNaN(Date.parse(value))
const nullable = (rule) => (value) => (value === null ? null : rule(value))
const idList = (max, message) => (value) => (Array.isArray(value) && value.length <= max && value.every(isId) && new Set(value).size === value.length ? null : message)

function check(body, rules, required = []) {
  const errors = {}
  const values = {}
  for (const [field, rule] of Object.entries(rules)) {
    if (body?.[field] === undefined) {
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

export const RULE_ACTIONS = ['percent', 'fixed']
export const RULE_STATUSES = ['active', 'inactive', 'scheduled', 'expired']
export const MAX_RULE_PRODUCTS = 500
const RULE_RULES = {
  name: (value) => (isText(value, { min: 1, max: 120 }) ? null : 'Enter a name of up to 120 characters.'),
  description: nullable((value) => (isText(value, { max: 500 }) ? null : 'Keep the description under 500 characters.')),
  isActive: (value) => (typeof value === 'boolean' ? null : 'Choose whether the rule is active.'),
  startsAt: nullable((value) => (isDate(value) ? null : 'Enter a valid start date, or leave it empty.')),
  endsAt: nullable((value) => (isDate(value) ? null : 'Enter a valid end date, or leave it empty.')),
  customerGroupIds: idList(50, 'Choose customer groups from the list.'),
  categoryIds: idList(200, 'Choose up to 200 categories.'),
  productIds: idList(MAX_RULE_PRODUCTS, `Choose up to ${MAX_RULE_PRODUCTS} products.`),
  action: (value) => (RULE_ACTIONS.includes(value) ? null : 'Choose percent off or a fixed amount off.'),
  amount: (value) => (isMoney(value) && value > 0 ? null : 'Enter an amount above 0 with at most 2 decimals.'),
  priority: (value) => (Number.isInteger(value) && value >= 0 && value <= 1000 ? null : 'Enter a priority from 0 to 1000 (lower runs first).'),
  stopFurther: (value) => (typeof value === 'boolean' ? null : 'Choose whether later rules still apply.'),
}

/** A catalog price rule. Cross-field rules (percent ≤ 100, dates in order) when both fields are sent. */
export function validateRule(body, { partial }) {
  const checked = check(body, RULE_RULES, partial ? [] : ['name', 'action', 'amount'])
  const { values, errors } = checked
  if (values.description === '') values.description = null
  if (values.action === 'percent' && values.amount !== undefined && values.amount > 100) errors.amount = ['Enter a percentage from 0.01 to 100.']
  if (values.startsAt && values.endsAt && Date.parse(values.endsAt) <= Date.parse(values.startsAt)) errors.endsAt = ['The end must be after the start.']
  if (partial && Object.keys(values).length === 0 && Object.keys(errors).length === 0) errors.name = ['Change at least one field.']
  return result(checked)
}

// ---- phase 7 cart price rules: the coupon fields added to validateCoupon (adminApi.js) ----

export const COUPON_APPLIES_TO = ['all', 'categories', 'products']
export const COUPON_KINDS = ['code', 'automatic']
const isUnits = (value) => Number.isInteger(value) && value >= 1 && value <= 100
const COUPON_RULE_FIELDS = {
  customerGroupIds: idList(50, 'Choose customer groups from the list.'),
  appliesTo: (value) => (COUPON_APPLIES_TO.includes(value) ? null : 'Choose the whole cart, categories, or products.'),
  categoryIds: idList(200, 'Choose up to 200 categories.'),
  productIds: idList(MAX_RULE_PRODUCTS, `Choose up to ${MAX_RULE_PRODUCTS} products.`),
  freeShipping: (value) => (typeof value === 'boolean' ? null : 'Choose whether the rule also gives free shipping.'),
  buyQuantity: nullable((value) => (isUnits(value) ? null : 'Enter how many to buy, from 1 to 100.')),
  getQuantity: nullable((value) => (isUnits(value) ? null : 'Enter how many are free, from 1 to 100.')),
  autoApply: (value) => (typeof value === 'boolean' ? null : 'Choose whether the rule applies without a code.'),
}

/**
 * Adds the cart-rule fields of a coupon to `values` (or their problems to
 * `errors`), with the rules that span fields when they are sent together:
 * an automatic rule has no code, a code rule needs one; categories/products
 * need a list; buy X get Y needs both quantities.
 */
export function checkCouponRuleFields(body, values, errors, { partial }) {
  const checked = check(body, COUPON_RULE_FIELDS)
  Object.assign(values, checked.values)
  Object.assign(errors, checked.errors)
  if (values.autoApply === true) {
    if (typeof body.code === 'string' && body.code.trim() !== '') errors.code = ['An automatic rule has no code.']
    else {
      delete errors.code
      values.code = null
    }
  } else if (!partial && (body.code === undefined || body.code === null || body.code === '')) errors.code = ['Enter a code, or make the rule automatic.']
  if (values.appliesTo === 'categories' && (values.categoryIds ?? []).length === 0 && !errors.categoryIds) errors.categoryIds = ['Choose at least one category.']
  if (values.appliesTo === 'products' && (values.productIds ?? []).length === 0 && !errors.productIds) errors.productIds = ['Choose at least one product.']
  if (values.type === 'buy_x_get_y') {
    if (!Number.isInteger(values.buyQuantity) && !errors.buyQuantity) errors.buyQuantity = ['Enter how many to buy, from 1 to 100.']
    if (!Number.isInteger(values.getQuantity) && !errors.getQuantity) errors.getQuantity = ['Enter how many are free, from 1 to 100.']
  }
  if (values.type === 'free_shipping') values.freeShipping = true
}

// Same limit as the API's HtmlSanitizer (content pages and campaigns).
export const MAX_BODY = 100_000
export const CAMPAIGN_STATUSES = ['draft', 'sending', 'sent']
const CAMPAIGN_RULES = {
  subject: (value) => (isText(value, { min: 1, max: 150 }) ? null : 'Enter a subject of up to 150 characters.'),
  preheader: nullable((value) => (isText(value, { max: 150 }) ? null : 'Keep the preview text under 150 characters.')),
  body: (value) => (typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_BODY ? null : `Write the email (up to ${MAX_BODY.toLocaleString('en-US')} characters).`),
}
export function validateCampaign(body, { partial }) {
  const checked = check(body, CAMPAIGN_RULES, partial ? [] : ['subject', 'body'])
  // The body is HTML: keep it as typed (the API sanitizes it); only the text fields are trimmed.
  if (typeof body?.body === 'string' && checked.values.body !== undefined) checked.values.body = body.body
  if (checked.values.preheader === '') checked.values.preheader = null
  if (partial && Object.keys(checked.values).length === 0 && Object.keys(checked.errors).length === 0) checked.errors.subject = ['Change at least one field.']
  return result(checked)
}

/**
 * A search term's redirect: a store path ("/products/12", no "//") or an
 * https address; null or "" removes it.
 */
export function validateRedirect(body) {
  const value = body?.redirectUrl
  if (value === null || value === '') return { values: { redirectUrl: null } }
  if (typeof value !== 'string') return { errors: { redirectUrl: ['Enter a store path like /category/shoes or an https:// address.'] } }
  const url = value.trim()
  const isPath = /^\/(?!\/)[^\s\\]*$/.test(url)
  const isHttps = /^https:\/\/[^\s]+$/i.test(url) && URL.canParse(url)
  if (url.length > 2048 || !(isPath || isHttps)) return { errors: { redirectUrl: ['Enter a store path like /category/shoes or an https:// address (up to 2048 characters).'] } }
  return { values: { redirectUrl: url } }
}

// ---- list filters, in the API's names ----

export const SUBSCRIBER_STATUSES = ['pending', 'subscribed', 'unsubscribed']
export const SUBSCRIBER_SOURCES = ['footer', 'account', 'checkout', 'admin']
function subscriberFilters(url) {
  return {
    q: search(url),
    status: oneOf(url.searchParams.get('status'), SUBSCRIBER_STATUSES),
    source: oneOf(url.searchParams.get('source'), SUBSCRIBER_SOURCES),
  }
}

export const CART_SORTS = ['newest', 'oldest', 'subtotal']
function cartFilters(url) {
  const whole = (key, max) => {
    const value = url.searchParams.get(key) ?? ''
    return /^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= max ? Number(value) : undefined
  }
  const subtotal = Number(url.searchParams.get('minSubtotal') ?? '')
  return {
    q: search(url),
    min_age_hours: whole('minAgeHours', 8760),
    max_age_days: whole('maxAgeDays', 3650),
    min_subtotal: url.searchParams.get('minSubtotal') && isMoney(subtotal) ? subtotal.toFixed(2) : undefined,
    sort: oneOf(url.searchParams.get('sort'), CART_SORTS),
  }
}

export const TERM_REPORTS = ['top', 'zero']
const termReportFilters = (url) => ({ q: search(url), type: oneOf(url.searchParams.get('type'), TERM_REPORTS) })
function termListFilters(url) {
  const redirect = url.searchParams.get('hasRedirect')
  return { q: search(url), has_redirect: redirect === 'true' || redirect === '1' ? '1' : redirect === 'false' || redirect === '0' ? '0' : undefined }
}

/** A term to send straight to a page (one nobody searched yet, or any other). */
export function validateNewTerm(body) {
  const redirect = validateRedirect(body)
  const errors = { ...redirect.errors }
  const term = typeof body?.term === 'string' ? body.term.trim().replace(/\s+/g, ' ').toLowerCase() : ''
  if (term.length < 1 || term.length > 100) errors.term = ['Enter the search term (up to 100 characters).']
  if (!errors.redirectUrl && redirect.values.redirectUrl === null) errors.redirectUrl = ['Enter where this search should go.']
  return Object.keys(errors).length > 0 ? { errors } : { values: { term, redirectUrl: redirect.values.redirectUrl } }
}

// The file name from the API's Content-Disposition, if it's a plain one; else ours.
function downloadName(disposition, fallback) {
  const name = /filename="?([A-Za-z0-9._-]{1,100})"?/.exec(disposition ?? '')?.[1]
  return name && name.endsWith('.csv') ? name : fallback
}

/** A CSV download from the API, passed on with its type and a safe file name. */
async function csvFile(ctx, path, fallbackName) {
  const file = await laravelFile(path, { token: ctx.token, request: ctx.request })
  if (file.text === undefined) return json(failed(file).body, file.status)
  return new Response(file.text, {
    status: 200,
    headers: {
      'Content-Type': file.contentType.startsWith('text/csv') ? file.contentType : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${downloadName(file.disposition, fallbackName)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
const withoutEmpty = (filters) => new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ''))

const withBody = (validate, options, handler) =>
  live(async (ctx) => {
    const { values, errors } = validate(await readBody(ctx.request), options)
    if (errors) return invalid(errors)
    return handler(ctx, values)
  })

const data = laravelMarketingData
export const MARKETING_ROUTES = {
  'GET catalog-rules': live(async (ctx) =>
    fromLaravel(await data.listRules(ctx.token, { q: search(ctx.url), status: oneOf(ctx.url.searchParams.get('status'), RULE_STATUSES), ...pageParams(ctx.url) }, ctx.request)),
  ),
  'POST catalog-rules': withBody(validateRule, { partial: false }, async (ctx, values) => fromLaravel(await data.createRule(ctx.token, values, ctx.request), 201)),
  'GET catalog-rules/:id': live(async (ctx) => fromLaravel(await data.getRule(ctx.token, ctx.id, ctx.request))),
  'PATCH catalog-rules/:id': withBody(validateRule, { partial: true }, async (ctx, values) => fromLaravel(await data.updateRule(ctx.token, ctx.id, values, ctx.request))),
  'DELETE catalog-rules/:id': live(async (ctx) => fromLaravel(await data.deleteRule(ctx.token, ctx.id, ctx.request), 200)),
  'GET catalog-rules/:id/preview': live(async (ctx) => fromLaravel(await data.previewRule(ctx.token, ctx.id, ctx.request))),

  'GET newsletter/subscribers': live(async (ctx) => fromLaravel(await data.listSubscribers(ctx.token, { ...subscriberFilters(ctx.url), ...pageParams(ctx.url) }, ctx.request))),
  'GET newsletter/subscribers/export.csv': live(async (ctx) => {
    const { q, ...filters } = subscriberFilters(ctx.url)
    return csvFile(ctx, `/api/admin/v1/newsletter/subscribers/export.csv?${withoutEmpty({ search: q, ...filters })}`, 'newsletter-subscribers.csv')
  }),
  'POST newsletter/subscribers/:id/unsubscribe': live(async (ctx) => fromLaravel(await data.unsubscribe(ctx.token, ctx.id, ctx.request))),
  'GET newsletter/campaigns': live(async (ctx) =>
    fromLaravel(await data.listCampaigns(ctx.token, { q: search(ctx.url), status: oneOf(ctx.url.searchParams.get('status'), CAMPAIGN_STATUSES), ...pageParams(ctx.url) }, ctx.request)),
  ),
  'POST newsletter/campaigns': withBody(validateCampaign, { partial: false }, async (ctx, values) => fromLaravel(await data.createCampaign(ctx.token, values, ctx.request), 201)),
  'GET newsletter/campaigns/:id': live(async (ctx) => fromLaravel(await data.getCampaign(ctx.token, ctx.id, ctx.request))),
  'PATCH newsletter/campaigns/:id': withBody(validateCampaign, { partial: true }, async (ctx, values) => fromLaravel(await data.updateCampaign(ctx.token, ctx.id, values, ctx.request))),
  'DELETE newsletter/campaigns/:id': live(async (ctx) => fromLaravel(await data.deleteCampaign(ctx.token, ctx.id, ctx.request), 200)),
  'POST newsletter/campaigns/:id/test': live(async (ctx) => fromLaravel(await data.testCampaign(ctx.token, ctx.id, ctx.request), 200)),
  'POST newsletter/campaigns/:id/send': live(async (ctx) => fromLaravel(await data.sendCampaign(ctx.token, ctx.id, ctx.request), 200)),

  'GET reports/abandoned-carts': live(async (ctx) => fromLaravel(await data.abandonedCarts(ctx.token, { ...cartFilters(ctx.url), ...pageParams(ctx.url) }, ctx.request))),
  'POST reports/abandoned-carts/:id/remind': live(async (ctx) => fromLaravel(await data.remindCart(ctx.token, ctx.id, ctx.request), 200)),
  'GET reports/search-terms': live(async (ctx) => fromLaravel(await data.searchTermReport(ctx.token, { ...termReportFilters(ctx.url), ...pageParams(ctx.url) }, ctx.request))),
  'GET search-terms': live(async (ctx) => fromLaravel(await data.listSearchTerms(ctx.token, { ...termListFilters(ctx.url), ...pageParams(ctx.url) }, ctx.request))),
  'POST search-terms': withBody(validateNewTerm, undefined, async (ctx, values) => fromLaravel(await data.createSearchTerm(ctx.token, values, ctx.request), 201)),
  'PATCH search-terms/:id': withBody(validateRedirect, undefined, async (ctx, values) => fromLaravel(await data.updateSearchTerm(ctx.token, ctx.id, values, ctx.request))),
  'DELETE search-terms/:id': live(async (ctx) => fromLaravel(await data.deleteSearchTerm(ctx.token, ctx.id, ctx.request), 200)),
}

const isIdText = (value) => /^[1-9]\d{0,8}$/.test(value ?? '')

/**
 * The marketing addresses under /api/admin (segments after it) → { route, id }.
 * undefined = not a marketing address (adminApi.js goes on with its own table);
 * null = a marketing address that doesn't exist (404).
 */
export function matchMarketingRoute(method, segments) {
  const [first, second, third, fourth, ...rest] = segments
  const found = (key, id) => ({ route: MARKETING_ROUTES[`${method} ${key}`], id })
  if (first === 'catalog-rules') {
    if (fourth !== undefined) return null
    if (second === undefined) return found('catalog-rules')
    if (!isIdText(second)) return null
    if (third === undefined) return found('catalog-rules/:id', second)
    return third === 'preview' ? found('catalog-rules/:id/preview', second) : null
  }
  if (first === 'newsletter') {
    if (rest.length > 0 || !['subscribers', 'campaigns'].includes(second)) return null
    if (third === undefined) return fourth === undefined ? found(`newsletter/${second}`) : null
    if (second === 'subscribers' && third === 'export.csv') return fourth === undefined ? found('newsletter/subscribers/export.csv') : null
    if (!isIdText(third)) return null
    if (fourth === undefined) return second === 'campaigns' ? found('newsletter/campaigns/:id', third) : null
    if (second === 'subscribers') return fourth === 'unsubscribe' ? found('newsletter/subscribers/:id/unsubscribe', third) : null
    return ['test', 'send'].includes(fourth) ? found(`newsletter/campaigns/:id/${fourth}`, third) : null
  }
  if (first === 'search-terms') {
    if (third !== undefined) return null
    if (second === undefined) return found('search-terms')
    return isIdText(second) ? found('search-terms/:id', second) : null
  }
  if (first === 'reports' && second === 'search-terms') return third === undefined ? found('reports/search-terms') : null
  if (first === 'reports' && second === 'abandoned-carts') {
    if (third === undefined) return fourth === undefined ? found('reports/abandoned-carts') : null
    return isIdText(third) && fourth === 'remind' && rest.length === 0 ? found('reports/abandoned-carts/:id/remind', third) : null
  }
  return undefined
}
