import { json, readBody } from './http.js'
import { MAX_TEMPLATE, SMS_EVENTS, SMS_LOCALES, SMS_PROVIDERS, SMS_STATUSES, laravelPhase20Data } from './shop/adminPhase20.js'

/*
 * Phase 20 admin routes and rules (docs/backend/PHASE20_CONTRACT.md §1
 * "Admin API"): SMS notifications for orders. BuyNest's Laravel API only.
 * Matched by adminApi.js before its own routes, so the admin session check
 * there runs first; the API checks the role's permission (settings.view /
 * settings.edit for the settings and the test send, orders.view for the log,
 * orders.edit for a retry) and answers 403 { code: "permission_denied",
 * permission }, passed on unchanged.
 *
 *   GET    /api/admin/sms                      → { settings: { enabled, provider: log|ssl_wireless|bulksmsbd, events: [order_placed…],
 *                                                templates: { event: { en, bn } } ("" = the default), confirmLink },
 *                                                providers: [{ key, label, configured }], stats: { sentToday, failedToday, sent30d },
 *                                                defaults: { templates: { event: { en, bn } } } }
 *   PUT    /api/admin/sms/settings             (any of the settings) → the same
 *   POST   /api/admin/sms/test                 { to (a Bangladeshi mobile), body? } → { message }
 *   GET    /api/admin/sms/messages?status&event (or test)&q&limit&skip
 *                                              → { messages: [{ id, order: { number }|null, event|null (a test), to, body, locale, segments,
 *                                                encoding: gsm|unicode, provider, status: queued|sent|failed, error, attempts, sentAt, createdAt }], total }
 *   POST   /api/admin/sms/messages/:id/retry   → { message } (a failed text, at most 5 attempts)
 *
 * The order page's texts ride on GET orders/:number (shop/admin.js): sms: [{ id|null, event, status, to, sentAt, createdAt, error }].
 */

const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const LIVE_ONLY = 'This needs the BuyNest backend; the demo data has no SMS.'
const live = (handler) => (ctx) => (realData() ? handler(ctx) : json({ message: LIVE_ONLY }, 404))
const fromLaravel = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))
const invalid = (errors) => json({ message: 'Please check the highlighted fields.', errors }, 422)
const MAX_PAGE = 100
const isIdText = (value) => /^\d{1,9}$/.test(value ?? '')

/**
 * A Bangladeshi mobile as typed (01712-345678, +880 1712 345678, 8801712345678)
 * → "+8801712345678", or null. The operator digit is 3 to 9.
 */
export function bdMobile(value) {
  if (typeof value !== 'string') return null
  const digits = value.replace(/[\s\-().]/g, '')
  const match = /^(?:\+?88)?(01[3-9]\d{8})$/.exec(digits)
  return match ? `+88${match[1]}` : null
}

const templateProblem = (text) => (typeof text !== 'string' && text !== null ? 'Enter the text, or leave it empty for the default.' : (text ?? '').length > MAX_TEMPLATE ? `Keep the text to ${MAX_TEMPLATE} characters.` : null)

/**
 * The SMS settings (partial): the same rules and words as the API, checked
 * here first. Templates: { event: { en?, bn? } }, each at most 480
 * characters, empty (or null) for the default.
 */
export function validateSmsSettings(body) {
  const errors = {}
  const values = {}
  if (body.enabled !== undefined) {
    if (typeof body.enabled === 'boolean') values.enabled = body.enabled
    else errors.enabled = ['Choose on or off.']
  }
  if (body.provider !== undefined) {
    if (SMS_PROVIDERS.includes(body.provider)) values.provider = body.provider
    else errors.provider = ['Choose a provider.']
  }
  if (body.events !== undefined) {
    const events = Array.isArray(body.events) ? body.events : null
    if (!events || !events.every((event) => SMS_EVENTS.includes(event))) errors.events = ['Choose the texts to send.']
    else if (events.length === 0 && body.enabled === true) errors.events = ['Choose at least one text to send.']
    else values.events = SMS_EVENTS.filter((event) => events.includes(event))
  }
  if (body.templates !== undefined) {
    const templates = body.templates && typeof body.templates === 'object' && !Array.isArray(body.templates) ? body.templates : null
    if (!templates) errors.templates = ['Send the templates per text.']
    else {
      const clean = {}
      for (const [event, entry] of Object.entries(templates)) {
        if (!SMS_EVENTS.includes(event) || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
          errors.templates = ['Send the templates per text.']
          continue
        }
        clean[event] = {}
        for (const [locale, text] of Object.entries(entry)) {
          if (!SMS_LOCALES.includes(locale)) {
            errors[`templates.${event}`] = ['Templates are in English (en) and Bangla (bn).']
            continue
          }
          const problem = templateProblem(text)
          if (problem) errors[`templates.${event}.${locale}`] = [problem]
          else clean[event][locale] = (text ?? '').trim() === '' ? '' : text
        }
      }
      if (!Object.keys(errors).some((key) => key.startsWith('templates'))) values.templates = clean
    }
  }
  if (body.confirmLink !== undefined) {
    if (typeof body.confirmLink === 'boolean') values.confirmLink = body.confirmLink
    else errors.confirmLink = ['Choose whether to include the link.']
  }
  if (Object.keys(values).length === 0 && Object.keys(errors).length === 0) errors.enabled = ['Change at least one setting.']
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

/** A test send: { to, body? } → { values: { to: "+8801…", body? } } or { errors }. */
export function validateSmsTest(body) {
  const errors = {}
  const to = bdMobile(body.to)
  if (!to) errors.to = ['Enter a Bangladeshi mobile number, like 01712345678.']
  let text
  if (body.body !== undefined && body.body !== null) {
    if (typeof body.body !== 'string') errors.body = ['Enter the text, or leave it empty.']
    else if (body.body.length > MAX_TEMPLATE) errors.body = [`Keep the text to ${MAX_TEMPLATE} characters.`]
    else if (body.body.trim() !== '') text = body.body.trim()
  }
  return Object.keys(errors).length > 0 ? { errors } : { values: { to, ...(text !== undefined && { body: text }) } }
}

function messageFilters(url) {
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), MAX_PAGE)
  const skip = Math.max(Number.parseInt(url.searchParams.get('skip') ?? '0', 10) || 0, 0)
  const status = url.searchParams.get('status')
  const event = url.searchParams.get('event')
  return {
    q: url.searchParams.get('q')?.trim().slice(0, 100) || undefined,
    status: SMS_STATUSES.includes(status) ? status : undefined,
    // "test": the test sends (no order).
    event: SMS_EVENTS.includes(event) || event === 'test' ? event : undefined,
    limit,
    skip,
  }
}

// ---- the routes ----

const PHASE20_ROUTES = {
  'GET sms': live(async (ctx) => fromLaravel(await laravelPhase20Data.sms(ctx.token, ctx.request))),
  'PUT sms/settings': live(async (ctx) => {
    const { values, errors } = validateSmsSettings(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase20Data.updateSettings(ctx.token, values, ctx.request))
  }),
  'POST sms/test': live(async (ctx) => {
    const { values, errors } = validateSmsTest(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase20Data.test(ctx.token, values, ctx.request))
  }),
  'GET sms/messages': live(async (ctx) => fromLaravel(await laravelPhase20Data.messages(ctx.token, messageFilters(ctx.url), ctx.request))),
  'POST sms/messages/:id/retry': live(async (ctx) => fromLaravel(await laravelPhase20Data.retry(ctx.token, ctx.id, ctx.request))),
}

/**
 * The phase 20 routes in adminApi.js's matcher: { route } for one of them,
 * null for a malformed address of theirs (404), undefined when not theirs.
 */
export function matchPhase20Route(method, segments) {
  const [first, second, third, fourth, ...rest] = segments
  if (first !== 'sms') return undefined
  if (rest.length > 0) return null
  if (second === undefined) return { route: PHASE20_ROUTES[`${method} sms`] }
  if ((second === 'settings' || second === 'test') && third === undefined) return { route: PHASE20_ROUTES[`${method} sms/${second}`] }
  if (second !== 'messages') return null
  if (third === undefined) return { route: PHASE20_ROUTES[`${method} sms/messages`] }
  if (isIdText(third) && fourth === 'retry') return { route: PHASE20_ROUTES[`${method} sms/messages/:id/retry`], id: third }
  return null
}
