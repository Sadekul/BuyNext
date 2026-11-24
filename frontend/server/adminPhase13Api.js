import { json, readBody } from './http.js'
import { CONTENT_ROUTES, isTemplateKey, validateTemplate } from './adminContentApi.js'
import { LOCALES, isLocale, laravelPhase13Data } from './shop/adminPhase13.js'

/*
 * Phase 13 admin routes and rules (docs/backend/PHASE13_CONTRACT.md §4 and
 * its implementation notes): the store in Bangla (bn) and English (en). The
 * admin itself stays English. BuyNest's Laravel API only. Matched by
 * adminApi.js before its own routes, so the admin session check there runs
 * first; the API checks the role's permission (products.edit,
 * categories.edit, content.edit, email_templates.manage, customers.edit,
 * settings.edit) and answers 403 { code: "permission_denied", permission },
 * passed on unchanged.
 *
 * EMAIL TEMPLATES PER LANGUAGE (email_templates.manage), ?locale=en|bn (no locale: English, as before):
 *   GET    /api/admin/email-templates                       → { templates: [{ key, name, description, subject, isCustomized, updatedAt, updatedBy,
 *                                                              locales: { en: { subject, isCustomized, updatedAt }, bn: { … } } }] }
 *   GET    /api/admin/email-templates/:key?locale=bn        → the template in Bangla + { locale }
 *   PUT    /api/admin/email-templates/:key?locale=bn        { subject, body } → { template }
 *   POST   /api/admin/email-templates/:key/preview?locale=bn { subject?, body? } → { subject, html, text, locale }
 *   POST   /api/admin/email-templates/:key/test?locale=bn    { subject?, body? } → { sent, to, message }
 *   POST   /api/admin/email-templates/:key/reset?locale=bn   → { template } (that language's default again; the other is kept)
 *
 * The rest rides on existing routes ('' or null in a Bangla text = not translated: the store shows the English one):
 *   GET/PUT products/:id           + bn: { name, shortDescription, description, metaTitle, metaDescription },
 *                                    specifications: [{ label, value, labelBn, valueBn }],
 *                                    options: [{ id, name, nameBn, values: [{ id, value, valueBn }] }] (read)
 *   PUT products/:id/options       + each option's nameBn and valuesBn (one per value, same order); left out = the saved Bangla names stay
 *   GET products                   + banglaStatus: complete | missing per row; ?bangla=complete|missing
 *   categories (POST/PATCH)        + bn: { name, description, metaTitle, metaDescription }
 *   pages (POST/PATCH)             + bn: { title, body, metaTitle, metaDescription }
 *   PUT home                       + hero.bn: { eyebrow, title, description, primaryCtaLabel, secondaryCtaLabel, imageAlt, highlights },
 *                                    banners[].bn: { eyebrow, title, description, ctaLabel, imageAlt },
 *                                    slides[].bn: { eyebrow, title, description, primaryCtaLabel, secondaryCtaLabel, imageAlt } (home slider)
 *   GET/PATCH customers/:id        + locale: en | bn | null (null = the store default)
 *   GET orders/:number             + locale: the language the order was placed in
 *   GET/PATCH settings             + general.defaultLocale (en | bn), general.banglaDigits (boolean)
 */

const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const fromLaravel = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))
const invalid = (errors) => json({ message: 'Please check the highlighted fields.', errors }, 422)
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// ---- Bangla texts ----

/** Each record's Bangla fields and their longest length (the English field's). */
export const BANGLA_LIMITS = {
  product: { name: 120, shortDescription: 500, description: 5000, metaTitle: 190, metaDescription: 500 },
  category: { name: 120, description: 5000, metaTitle: 190, metaDescription: 500 },
  page: { title: 160, body: 100_000, metaTitle: 160, metaDescription: 300 },
  hero: { eyebrow: 60, title: 120, description: 300, primaryCtaLabel: 40, secondaryCtaLabel: 40, imageAlt: 200 },
  banner: { eyebrow: 60, title: 120, description: 300, ctaLabel: 40, imageAlt: 200 },
  // Home slider (docs/backend/HOME_SLIDER_CONTRACT.md §1): a slide's image description is up to 160.
  slide: { eyebrow: 60, title: 120, description: 300, primaryCtaLabel: 40, secondaryCtaLabel: 40, imageAlt: 160 },
}
const MAX_HIGHLIGHTS = 3

/**
 * `bn` of a record: { field: text | null } (only known fields; all optional).
 * Texts are trimmed (HTML bodies kept as typed; the API sanitizes them), ''
 * becomes null. Errors as `${path}.${field}`.
 */
export function checkBangla(value, kind, path = 'bn') {
  const errors = {}
  if (!isObject(value)) return { errors: { [path]: ['Send the Bangla texts as fields.'] } }
  const values = {}
  for (const [field, max] of Object.entries(BANGLA_LIMITS[kind])) {
    const text = value[field]
    if (text === undefined) continue
    if (text !== null && typeof text !== 'string') errors[`${path}.${field}`] = ['Enter text.']
    else if (text !== null && text.length > max) errors[`${path}.${field}`] = [`Keep this under ${max.toLocaleString('en-US')} characters.`]
    else values[field] = text === null || text.trim() === '' ? null : field === 'body' ? text : text.trim()
  }
  if (kind === 'hero' && value.highlights !== undefined) {
    const list = value.highlights
    if (!Array.isArray(list) || list.length > MAX_HIGHLIGHTS || !list.every((text) => typeof text === 'string' && text.length <= 80)) errors[`${path}.highlights`] = ['Keep up to 3 highlights of up to 80 characters.']
    else values.highlights = list.map((text) => text.trim())
  }
  return { errors, values }
}

/** A product write's `bn` (optional) → checked into `values`, problems into `errors`. */
export function checkProductBangla(body, values, errors) {
  if (body.bn === undefined) return
  const checked = checkBangla(body.bn, 'product')
  Object.assign(errors, checked.errors)
  if (Object.keys(checked.errors).length === 0 && Object.keys(checked.values).length > 0) values.bn = checked.values
}

const trimmedOrNull = (text) => (typeof text === 'string' && text.trim() !== '' ? text.trim() : null)
const isShortText = (text, max) => text === null || text === undefined || (typeof text === 'string' && text.trim().length <= max)

/**
 * PUT products/:id/options: one option's Bangla names (both optional): { nameBn?, valuesBn? }
 * (null / '' = not translated). Problems go into `errors` as options.N.nameBn / options.N.valuesBn.
 */
export function optionBangla(option, index, valueCount, errors) {
  const out = {}
  if (option?.nameBn !== undefined) {
    if (!isShortText(option.nameBn, 40)) errors[`options.${index}.nameBn`] = ['Keep the Bangla name to 40 characters or fewer.']
    else out.nameBn = trimmedOrNull(option.nameBn)
  }
  if (option?.valuesBn !== undefined) {
    const list = option.valuesBn
    if (!Array.isArray(list) || list.length > valueCount || !list.every((text) => isShortText(text, 40))) errors[`options.${index}.valuesBn`] = ['Give each value a Bangla name of up to 40 characters, in the same order.']
    else out.valuesBn = list.map(trimmedOrNull)
  }
  return out
}

/** Specification rows' Bangla label and value (optional): null when fine, else the message. */
export function specificationsBanglaProblem(rows) {
  if (!Array.isArray(rows)) return null
  for (const row of rows) {
    for (const [field, max] of [['labelBn', 60], ['valueBn', 255]]) {
      const text = row?.[field]
      if (text !== undefined && text !== null && (typeof text !== 'string' || text.trim().length > max)) return `Keep every Bangla ${field === 'labelBn' ? 'label' : 'value'} under ${max} characters.`
    }
  }
  return null
}
/** Rows after specificationsProblem: trimmed; the Bangla texts only on rows that sent them ('' → null). */
export const cleanSpecificationsBangla = (rows, cleaned) =>
  cleaned.map((row, index) => {
    const sent = rows[index] ?? {}
    if (sent.labelBn === undefined && sent.valueBn === undefined) return row
    return { ...row, labelBn: trimmedOrNull(sent.labelBn), valueBn: trimmedOrNull(sent.valueBn) }
  })

// ---- customers and settings ----

/** PATCH customers/:id { locale }: "en" | "bn" | null (the store default). */
export const localeRule = (value) => (value === null || isLocale(value) ? null : 'Choose English, Bangla, or the store default.')
export const LANGUAGE_SETTING_RULES = {
  defaultLocale: (value) => (isLocale(value) ? null : 'Choose English or Bangla.'),
  banglaDigits: (value) => (typeof value === 'boolean' ? null : 'Choose whether Bangla uses Bangla digits.'),
}

/** ?bangla=complete|missing of the products grid, else undefined. */
export const banglaFilter = (url) => (['complete', 'missing'].includes(url.searchParams.get('bangla')) ? url.searchParams.get('bangla') : undefined)

// ---- email templates per language ----

/** ?locale: undefined when not sent (English, the phase 7 routes), else "en" | "bn", or false when it is something else. */
function localeOf(url) {
  const locale = url.searchParams.get('locale')
  if (locale === null || locale === '') return undefined
  return isLocale(locale) ? locale : false
}
const badLocale = () => invalid({ locale: [`Choose one of ${LOCALES.join(', ')}.`] })

/** A template route with a language: the phase 13 handler; without one, the phase 7 route unchanged. */
const perLocale = (phase7Key, handler) => (ctx) => {
  if (!realData()) return CONTENT_ROUTES[phase7Key](ctx)
  const locale = localeOf(ctx.url)
  if (locale === false) return badLocale()
  return locale === undefined ? CONTENT_ROUTES[phase7Key](ctx) : handler(ctx, locale)
}
const drafted = (handler) => async (ctx, locale) => {
  const { values, errors } = validateTemplate(await readBody(ctx.request), { draft: true })
  if (errors) return invalid(errors)
  return handler(ctx, locale, values)
}

const PHASE13_ROUTES = {
  // Every language's subject and status on each row (a superset of the phase 7 list).
  async 'GET email-templates'(ctx) {
    if (!realData()) return CONTENT_ROUTES['GET email-templates'](ctx)
    return fromLaravel(await laravelPhase13Data.listEmailTemplates(ctx.token, ctx.request))
  },
  'GET email-templates/:id': perLocale('GET email-templates/:id', async (ctx, locale) => fromLaravel(await laravelPhase13Data.getEmailTemplate(ctx.token, ctx.id, locale, ctx.request))),
  'PUT email-templates/:id': perLocale('PUT email-templates/:id', async (ctx, locale) => {
    const { values, errors } = validateTemplate(await readBody(ctx.request), { draft: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase13Data.updateEmailTemplate(ctx.token, ctx.id, locale, values, ctx.request))
  }),
  'POST email-templates/:id/preview': perLocale(
    'POST email-templates/:id/preview',
    drafted(async (ctx, locale, values) => fromLaravel(await laravelPhase13Data.previewEmailTemplate(ctx.token, ctx.id, locale, values, ctx.request))),
  ),
  'POST email-templates/:id/test': perLocale(
    'POST email-templates/:id/test',
    drafted(async (ctx, locale, values) => fromLaravel(await laravelPhase13Data.testEmailTemplate(ctx.token, ctx.id, locale, values, ctx.request))),
  ),
  'POST email-templates/:id/reset': perLocale('POST email-templates/:id/reset', async (ctx, locale) => fromLaravel(await laravelPhase13Data.resetEmailTemplate(ctx.token, ctx.id, locale, ctx.request))),
}

/**
 * The phase 13 routes in adminApi.js's matcher: { route, id } for one of
 * them, null for a malformed address of theirs (404), undefined when not theirs.
 */
export function matchPhase13Route(method, segments) {
  const [first, second, third, ...rest] = segments
  if (first !== 'email-templates') return undefined
  if (rest.length > 0) return null
  if (second === undefined) return { route: PHASE13_ROUTES[`${method} email-templates`] }
  if (!isTemplateKey(second)) return null
  if (third === undefined) return { route: PHASE13_ROUTES[`${method} email-templates/:id`], id: second }
  return ['preview', 'test', 'reset'].includes(third) ? { route: PHASE13_ROUTES[`${method} email-templates/:id/${third}`], id: second } : null
}
