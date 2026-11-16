import { json, multipartType, readBody, readLimitedBody } from './http.js'
import { laravelContentData } from './shop/adminContent.js'

/*
 * Phase 7 admin routes, system part (docs/backend/PHASE7_CONTRACT.md §4, §5,
 * §7, "Implementation notes — part B"), Laravel only. Merged into
 * adminApi.js's route table, so the admin session check there runs first;
 * the API then checks the role's permission (email_templates.manage,
 * seo.manage; notifications and preferences need none, they are filtered by
 * permission / the admin's own) and answers 403 { code: "permission_denied",
 * permission }, passed on unchanged.
 *
 *   GET    /api/admin/email-templates                → { templates: [{ key, name, description, subject, isCustomized, updatedAt, updatedBy }] }
 *   GET    /api/admin/email-templates/:key           → the template + { body, defaultSubject, defaultBody,
 *                                                       variables: [{ name, description, kind: text|block, required }], requiredGroups: [[name]] }
 *   PUT    /api/admin/email-templates/:key           { subject, body } → { template }
 *   POST   /api/admin/email-templates/:key/preview   { subject?, body? } → { subject, html, text } (sample data; nothing saved)
 *   POST   /api/admin/email-templates/:key/test      { subject?, body? } → { sent, to, message } (to the signed-in admin)
 *   POST   /api/admin/email-templates/:key/reset     → { template } (the default again)
 *   GET    /api/admin/redirects?q&statusCode&limit&skip → { redirects: [{ id, fromPath, toPath, statusCode, hits, createdAt, updatedAt }], total }
 *   POST   /api/admin/redirects                      { fromPath, toPath, statusCode? } → 201 { redirect }
 *   PATCH  /api/admin/redirects/:id                  (the same fields) → { redirect }
 *   DELETE /api/admin/redirects/:id                  → { deleted: true }
 *   POST   /api/admin/redirects/import               multipart file (CSV ≤ 2 MB) → { created, updated, skipped, errors: [{ row, message }] }
 *   GET    /api/admin/notifications?unread&limit&skip → { notifications: [{ id, type, severity, title, body, link, createdAt, readAt }], unreadCount, total }
 *   POST   /api/admin/notifications/:id/read         → { notification }
 *   POST   /api/admin/notifications/read-all         → { marked, unreadCount }
 *   GET    /api/admin/preferences/:key               (products_grid | orders_grid | customers_grid)
 *                                                    → { key, columns | null, pageSize | null, sort, direction, filters: [{ name, query }] }
 *   PUT    /api/admin/preferences/:key               (the same fields) → the same; replaces the whole value
 */

const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const fromLaravel = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))
const invalid = (errors) => json({ message: 'Please check the highlighted fields.', errors }, 422)
const LIVE_ONLY = 'This needs the BuyNest backend; the demo data has no email templates, redirects, notifications, or saved grid settings.'
const live = (handler) => (ctx) => (realData() ? handler(ctx) : json({ message: LIVE_ONLY }, 404))

const isId = (value) => /^\d{1,9}$/.test(value ?? '')
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
function pageParams(url, { max = 100, fallback = 20 } = {}) {
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? String(fallback), 10) || fallback, 1), max)
  const skip = Math.max(Number.parseInt(url.searchParams.get('skip') ?? '0', 10) || 0, 0)
  return { limit, skip }
}

// ---- email templates ----

export const isTemplateKey = (value) => /^[a-z][a-z0-9_]{0,59}$/.test(value ?? '')
const MAX_SUBJECT = 200
const MAX_BODY = 100_000

/** { subject, body } for a save (both required), or a draft for preview/test (either one). */
export function validateTemplate(body, { draft }) {
  const errors = {}
  const values = {}
  if (body.subject !== undefined || !draft) {
    if (typeof body.subject !== 'string' || body.subject.trim().length < 1 || body.subject.trim().length > MAX_SUBJECT) errors.subject = [`Enter a subject of up to ${MAX_SUBJECT} characters.`]
    else values.subject = body.subject.trim()
  }
  if (body.body !== undefined || !draft) {
    if (typeof body.body !== 'string' || body.body.trim().length < 1 || body.body.length > MAX_BODY) errors.body = ['Enter the email body (up to 100,000 characters).']
    else values.body = body.body // HTML as typed; the API sanitizes it
  }
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

// ---- redirects ----

/** A store path: one leading "/", no query, fragment, or spaces. */
export const isFromPath = (value) => typeof value === 'string' && value.length >= 2 && value.length <= 255 && /^\/(?!\/)[^\s?#]*$/.test(value)
/** A store path (query allowed) or an https:// address. */
export const isToPath = (value) => typeof value === 'string' && value.length <= 2048 && (/^\/(?!\/)\S*$/.test(value) || /^https:\/\/[^\s/?#]+\S*$/i.test(value))

const REDIRECT_RULES = {
  fromPath: (value) => (isFromPath(value?.trim?.()) ? null : 'Enter a store path starting with /, without ? or #, for example /old-sale.'),
  toPath: (value) => (isToPath(value?.trim?.()) ? null : 'Enter a store path starting with / or an https:// address.'),
  statusCode: (value) => ([301, 302].includes(value) ? null : 'Choose 301 (permanent) or 302 (temporary).'),
}
export function validateRedirect(body, { partial }) {
  const errors = {}
  const values = {}
  for (const [field, rule] of Object.entries(REDIRECT_RULES)) {
    if (body[field] === undefined) {
      if (!partial && field !== 'statusCode') errors[field] = [rule(undefined)]
      continue
    }
    const problem = rule(body[field])
    if (problem) errors[field] = [problem]
    else values[field] = typeof body[field] === 'string' ? body[field].trim() : body[field]
  }
  if (!errors.toPath && values.toPath !== undefined && values.toPath === values.fromPath) errors.toPath = ['A redirect must go somewhere else.']
  if (partial && Object.keys(values).length === 0 && Object.keys(errors).length === 0) errors.fromPath = ['Change at least one field.']
  return Object.keys(errors).length > 0 ? { errors } : { values }
}
const MAX_CSV_BYTES = 2 * 1024 * 1024 + 64 * 1024 // the API's 2 MB, plus the multipart framing

// ---- grid preferences ----

export const PREFERENCE_KEYS = ['products_grid', 'orders_grid', 'customers_grid']
const PAGE_SIZES = [10, 20, 25, 50, 100]
const MAX_FILTERS = 20
const MAX_PREFERENCES_BYTES = 16 * 1024
const isShortText = (value, max) => typeof value === 'string' && value.trim().length >= 1 && value.length <= max

/** A saved filter's params: up to 30 plain string (or number) values, as the grid's URL has them. */
const isQuery = (value) =>
  isPlainObject(value) &&
  Object.keys(value).length <= 30 &&
  Object.entries(value).every(([key, entry]) => /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key) && (typeof entry === 'string' ? entry.length <= 200 : Number.isFinite(entry)))

/** PUT /preferences/:key: the whole value, every field checked; unknown fields dropped. */
export function validatePreferences(body) {
  const errors = {}
  const values = {}
  if (body.columns !== undefined && body.columns !== null) {
    if (Array.isArray(body.columns) && body.columns.length <= 50 && body.columns.every((id) => isShortText(id, 60))) values.columns = [...new Set(body.columns)]
    else errors.columns = ['Choose the columns from the list.']
  }
  if (body.pageSize !== undefined && body.pageSize !== null) {
    if (PAGE_SIZES.includes(body.pageSize)) values.pageSize = body.pageSize
    else errors.pageSize = [`Choose ${PAGE_SIZES.join(', ')} rows per page.`]
  }
  if (body.sort !== undefined && body.sort !== null) {
    if (isShortText(body.sort, 60)) values.sort = body.sort
    else errors.sort = ['Choose a sort order.']
  }
  if (body.direction !== undefined && body.direction !== null) {
    if (['asc', 'desc'].includes(body.direction)) values.direction = body.direction
    else errors.direction = ['Choose ascending or descending.']
  }
  if (body.filters !== undefined && body.filters !== null) {
    const ok = Array.isArray(body.filters) && body.filters.length <= MAX_FILTERS && body.filters.every((filter) => isPlainObject(filter) && isShortText(filter.name, 60) && isQuery(filter.query ?? {}))
    if (!ok) errors.filters = [`Keep up to ${MAX_FILTERS} saved filters, each with a name of up to 60 characters.`]
    else {
      const names = body.filters.map((filter) => filter.name.trim().toLowerCase())
      if (new Set(names).size !== names.length) errors.filters = ['Each saved filter needs its own name.']
      else values.filters = body.filters.map((filter) => ({ name: filter.name.trim(), query: filter.query ?? {} }))
    }
  }
  if (Object.keys(errors).length === 0 && JSON.stringify(values).length > MAX_PREFERENCES_BYTES) errors.filters = ['These settings are too large to save. Delete some saved filters.']
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

// ---- routes ----

export const CONTENT_ROUTES = {
  'GET email-templates': live(async (ctx) => fromLaravel(await laravelContentData.listEmailTemplates(ctx.token, ctx.request))),
  'GET email-templates/:id': live(async (ctx) => fromLaravel(await laravelContentData.getEmailTemplate(ctx.token, ctx.id, ctx.request))),
  'PUT email-templates/:id': live(async (ctx) => {
    const { values, errors } = validateTemplate(await readBody(ctx.request), { draft: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelContentData.updateEmailTemplate(ctx.token, ctx.id, values, ctx.request))
  }),
  'POST email-templates/:id/preview': live(async (ctx) => {
    const { values, errors } = validateTemplate(await readBody(ctx.request), { draft: true })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelContentData.previewEmailTemplate(ctx.token, ctx.id, values, ctx.request))
  }),
  'POST email-templates/:id/test': live(async (ctx) => {
    const { values, errors } = validateTemplate(await readBody(ctx.request), { draft: true })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelContentData.testEmailTemplate(ctx.token, ctx.id, values, ctx.request))
  }),
  'POST email-templates/:id/reset': live(async (ctx) => fromLaravel(await laravelContentData.resetEmailTemplate(ctx.token, ctx.id, ctx.request))),

  'GET redirects': live(async (ctx) => {
    const { searchParams } = ctx.url
    const statusCode = Number(searchParams.get('statusCode'))
    const filters = { q: searchParams.get('q')?.trim().slice(0, 100) || undefined, statusCode: [301, 302].includes(statusCode) ? statusCode : undefined, ...pageParams(ctx.url) }
    return fromLaravel(await laravelContentData.listRedirects(ctx.token, filters, ctx.request))
  }),
  'POST redirects': live(async (ctx) => {
    const { values, errors } = validateRedirect(await readBody(ctx.request), { partial: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelContentData.createRedirect(ctx.token, values, ctx.request), 201)
  }),
  'PATCH redirects/:id': live(async (ctx) => {
    const { values, errors } = validateRedirect(await readBody(ctx.request), { partial: true })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelContentData.updateRedirect(ctx.token, ctx.id, values, ctx.request))
  }),
  'DELETE redirects/:id': live(async (ctx) => fromLaravel(await laravelContentData.deleteRedirect(ctx.token, ctx.id, ctx.request), 200)),
  'POST redirects/import': live(async (ctx) => {
    const contentType = multipartType(ctx.request)
    if (!contentType) return invalid({ file: ['Send the file as a form upload (multipart/form-data).'] })
    const { bytes, tooLarge } = await readLimitedBody(ctx.request, MAX_CSV_BYTES)
    if (tooLarge) return json({ message: 'The file is too large (at most 2 MB).', errors: { file: ['The file is too large (at most 2 MB).'] } }, 413)
    if (bytes.byteLength === 0) return invalid({ file: ['Choose a CSV file.'] })
    return fromLaravel(await laravelContentData.importRedirects(ctx.token, { contentType, bytes }, ctx.request))
  }),

  'GET notifications': live(async (ctx) => {
    const unread = ['1', 'true'].includes(ctx.url.searchParams.get('unread') ?? '')
    return fromLaravel(await laravelContentData.listNotifications(ctx.token, { unread, ...pageParams(ctx.url, { max: 50 }) }, ctx.request))
  }),
  'POST notifications/:id/read': live(async (ctx) => fromLaravel(await laravelContentData.readNotification(ctx.token, ctx.id, ctx.request))),
  'POST notifications/read-all': live(async (ctx) => fromLaravel(await laravelContentData.readAllNotifications(ctx.token, ctx.request))),

  'GET preferences/:id': live(async (ctx) => fromLaravel(await laravelContentData.getPreferences(ctx.token, ctx.id, ctx.request))),
  'PUT preferences/:id': live(async (ctx) => {
    const { values, errors } = validatePreferences(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelContentData.savePreferences(ctx.token, ctx.id, values, ctx.request))
  }),
}

/** The resources this module answers; adminApi.js hands their paths to matchContentRoute. */
export const CONTENT_RESOURCES = ['email-templates', 'redirects', 'notifications', 'preferences']

/**
 * /api/admin/<resource>[/<id>[/<action>]] for CONTENT_RESOURCES → { route, id },
 * or null (a 404 before any upstream call) for anything malformed.
 */
export function matchContentRoute(method, [resource, id, action, ...rest]) {
  if (rest.length > 0) return null
  const route = (key, matchedId) => ({ route: CONTENT_ROUTES[`${method} ${key}`], id: matchedId })
  if (id === undefined) return route(resource)
  switch (resource) {
    case 'email-templates':
      if (!isTemplateKey(id)) return null
      if (action === undefined) return route('email-templates/:id', id)
      return ['preview', 'test', 'reset'].includes(action) ? route(`email-templates/:id/${action}`, id) : null
    case 'redirects':
      if (id === 'import' && action === undefined) return route('redirects/import')
      return isId(id) && action === undefined ? route('redirects/:id', id) : null
    case 'notifications':
      if (id === 'read-all' && action === undefined) return route('notifications/read-all')
      return isId(id) && action === 'read' ? route('notifications/:id/read', id) : null
    case 'preferences':
      return PREFERENCE_KEYS.includes(id) && action === undefined ? route('preferences/:id', id) : null
    default:
      return null
  }
}
