import { laravel } from '../http.js'
import { failed } from './adminSystem.js'
import { emailTemplate, emailTemplateSummary } from './adminContent.js'

/*
 * Phase 13 admin data from BuyNest's Laravel API (docs/backend/PHASE13_CONTRACT.md
 * and its "Implementation notes"): the Bangla (bn) texts of products,
 * categories, CMS pages and home blocks, product options and specification
 * rows, email templates per language, the customer's and the order's
 * language, Settings → General's default language and Bangla digits, and the
 * products grid's "Bangla: complete / missing".
 *
 * The admin app's names: every translatable record carries `bn: { … }` with
 * the same field names as its English fields ('' = not translated: the store
 * falls back to the English text). Only listed fields go either way.
 * Every call resolves to { ok: true, status, data } or { ok: false, status, body }.
 */

export const LOCALES = ['en', 'bn']
export const isLocale = (value) => LOCALES.includes(value)
const str = (value) => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value))
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/*
 * The translatable fields of each record: the admin's name → the API's name.
 * The API keeps a record's Bangla texts under `translations.bn` (the
 * *_translations tables); flat `<field>_bn` keys are read too.
 */
export const BANGLA_FIELDS = {
  product: { name: 'name', shortDescription: 'short_description', description: 'description', metaTitle: 'meta_title', metaDescription: 'meta_description' },
  category: { name: 'name', description: 'description', metaTitle: 'meta_title', metaDescription: 'meta_description' },
  page: { title: 'title', body: 'body', metaTitle: 'meta_title', metaDescription: 'meta_description' },
  hero: { eyebrow: 'eyebrow', title: 'title', description: 'description', primaryCtaLabel: 'primary_cta_label', secondaryCtaLabel: 'secondary_cta_label', imageAlt: 'image_alt' },
  banner: { eyebrow: 'eyebrow', title: 'title', description: 'description', ctaLabel: 'cta_label', imageAlt: 'image_alt' },
  // Home slider (docs/backend/HOME_SLIDER_CONTRACT.md): a slide's texts, kept in its `bn` like the hero's.
  slide: { eyebrow: 'eyebrow', title: 'title', description: 'description', primaryCtaLabel: 'primary_cta_label', secondaryCtaLabel: 'secondary_cta_label', imageAlt: 'image_alt' },
}

/** The API record's Bangla texts → { field: text } in the admin's names ('' = falls back to English). Home blocks keep them in `bn`. */
export function banglaTexts(raw, kind) {
  const source = isObject(raw?.translations?.bn) ? raw.translations.bn : isObject(raw?.bn) ? raw.bn : {}
  return Object.fromEntries(Object.entries(BANGLA_FIELDS[kind]).map(([field, api]) => [field, str(source[api] ?? raw?.[`${api}_bn`])]))
}

/** Validated Bangla texts (admin names; '' or null = none) → `{ translations: { bn: { api_name: text | null } } }`. */
export function toBanglaBody(bn, kind) {
  const fields = BANGLA_FIELDS[kind]
  const out = Object.fromEntries(Object.entries(bn).filter(([field]) => fields[field]).map(([field, value]) => [fields[field], value === '' ? null : value]))
  return { translations: { bn: out } }
}

/** An API body + the record's Bangla texts when `values.bn` was sent. */
export const withBanglaBody = (body, values, kind) => (values.bn ? { ...body, ...toBanglaBody(values.bn, kind) } : body)
/** `{ bn }` of a record when the API sent its translations (older answers: nothing). */
export const banglaOf = (raw, kind) =>
  raw && (raw.translations !== undefined || (HOME_KINDS.includes(kind) && raw.bn !== undefined) || Object.values(BANGLA_FIELDS[kind]).some((api) => raw[`${api}_bn`] !== undefined)) ? { bn: banglaTexts(raw, kind) } : {}
const HOME_KINDS = ['hero', 'banner', 'slide']

/** The home hero's Bangla texts (+ highlights), when the API sent them. */
export function heroBangla(raw) {
  const found = banglaOf(raw, 'hero')
  if (!found.bn) return {}
  const highlights = raw?.bn?.highlights ?? raw?.translations?.bn?.highlights ?? raw?.highlights_bn
  return { bn: { ...found.bn, highlights: Array.isArray(highlights) ? highlights.map(str) : [] } }
}
/** Validated home Bangla texts → the API's `hero.bn` (+ highlights) and `banners[].bn` (snake_case; null = English is shown). */
export function toHeroBangla(bn) {
  if (!bn) return {}
  const out = toBanglaBody(bn, 'hero').translations.bn
  if (bn.highlights) out.highlights = bn.highlights.filter(Boolean)
  return { bn: out }
}
export const toBannerBangla = (bn) => (bn ? { bn: toBanglaBody(bn, 'banner').translations.bn } : {})
/** Home slider: a validated slide's Bangla texts → the API's `slides[].bn` (snake_case; null = English is shown). */
export const toSlideBangla = (bn) => (bn ? { bn: toBanglaBody(bn, 'slide').translations.bn } : {})

// ---- products ----

/**
 * "complete" | "missing": whether the Bangla name (and description, when the
 * product has one) are there: the API's `bangla: { complete, missing: [fields] }`
 * or `bangla_complete` (the grid's column and filter).
 */
export const banglaStatus = (raw) => {
  const complete = typeof raw?.bangla?.complete === 'boolean' ? raw.bangla.complete : raw?.bangla_complete
  return typeof complete === 'boolean' ? (complete ? 'complete' : 'missing') : undefined
}

/** The phase 13 fields of an admin product (only what the API sent). */
export function productPhase13(raw) {
  const fields = {}
  Object.assign(fields, banglaOf(raw, 'product'))
  const status = banglaStatus(raw)
  if (status) fields.banglaStatus = status
  return fields
}

/** A specification row's Bangla label and value ('' = the English one is shown). */
export const specificationBangla = (row) => ({ labelBn: str(row?.label_bn ?? row?.translations?.bn?.label), valueBn: str(row?.value_bn ?? row?.translations?.bn?.value) })
/** Validated rows (admin names) → the API's ({ label, value, label_bn, value_bn }; null = none). */
export const toSpecificationRows = (rows) => rows.map((row) => ({ label: row.label, value: row.value, label_bn: row.labelBn || null, value_bn: row.valueBn || null }))

/** An option's / option value's Bangla name ('' = the English one is shown). */
export const optionNameBangla = (raw) => str(raw?.name_bn ?? raw?.translations?.bn?.name)
export const optionValueBangla = (raw) => str(raw?.value_bn ?? raw?.translations?.bn?.value)

/** A validated option (admin names) → the API's: + name_bn and values_bn (one per value, same order) only when sent. */
export const toOptionBody = ({ name, values, nameBn, valuesBn }) => ({
  name,
  values,
  ...(nameBn !== undefined && { name_bn: nameBn }),
  ...(valuesBn !== undefined && { values_bn: valuesBn }),
})

/** The admin's product filter → the API's (`bangla=complete|missing`). */
export const BANGLA_FILTERS = { complete: 'complete', missing: 'missing' }

// ---- customers and orders ----

/** The customer's language: "en" | "bn" | null (null = the store default). Only when the API sent it. */
export const customerLocale = (raw) => (raw && raw.locale !== undefined ? { locale: isLocale(raw.locale) ? raw.locale : null } : {})
/** The language the order was placed in (its emails and PDFs use it for guests). */
export const orderLocale = (raw) => (raw && raw.locale !== undefined ? { locale: isLocale(raw.locale) ? raw.locale : null } : {})

// ---- email templates per language ----

/** One template's languages in the list: { en: { subject, isCustomized, updatedAt }, bn: { … } }. */
function templateLocales(raw) {
  const locales = isObject(raw?.locales) ? raw.locales : {}
  return Object.fromEntries(
    LOCALES.filter((locale) => isObject(locales[locale])).map((locale) => [
      locale,
      { subject: str(locales[locale].subject), isCustomized: locales[locale].is_customized === true, updatedAt: locales[locale].updated_at ?? null },
    ]),
  )
}

/** The list item, + `locales` (each language's subject and whether it was changed). */
export const emailTemplateRow = (raw) => ({ ...emailTemplateSummary(raw), ...(isObject(raw?.locales) && { locales: templateLocales(raw) }) })
/** The detail in one language, + `locale` (the language it is in). */
export const emailTemplateIn = (raw, locale) => ({ ...emailTemplate(raw), locale: isLocale(raw?.locale) ? raw.locale : locale })

const call = (path, token, request, options = {}) => laravel(`/api/admin/v1${path}`, { token, request, ...options })
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : failed(result))
const withLocale = (path, locale) => `${path}?locale=${locale}`

export const laravelPhase13Data = {
  async listEmailTemplates(token, request) {
    return answer(await call('/email-templates', token, request), [200], (data) => ({ templates: (Array.isArray(data?.data) ? data.data : []).map(emailTemplateRow), live: true }))
  },
  async getEmailTemplate(token, key, locale, request) {
    return answer(await call(withLocale(`/email-templates/${key}`, locale), token, request), [200], (data) => ({ ...emailTemplateIn(data.data, locale), live: true }))
  },
  async updateEmailTemplate(token, key, locale, values, request) {
    const result = await call(withLocale(`/email-templates/${key}`, locale), token, request, { method: 'PUT', body: { ...values, locale } })
    return answer(result, [200], (data) => ({ template: emailTemplateIn(data.data, locale), live: true }))
  },
  async previewEmailTemplate(token, key, locale, values, request) {
    const result = await call(withLocale(`/email-templates/${key}/preview`, locale), token, request, { method: 'POST', body: { ...values, locale } })
    return answer(result, [200], (data) => ({ subject: str(data?.data?.subject), html: str(data?.data?.html), text: str(data?.data?.text), locale }))
  },
  async testEmailTemplate(token, key, locale, values, request) {
    const result = await call(withLocale(`/email-templates/${key}/test`, locale), token, request, { method: 'POST', body: { ...values, locale } })
    return answer(result, [200, 202], (data) => ({ sent: true, to: data?.data?.email ?? null, message: str(data?.message) }))
  },
  async resetEmailTemplate(token, key, locale, request) {
    const result = await call(withLocale(`/email-templates/${key}/reset`, locale), token, request, { method: 'POST', body: { locale } })
    return answer(result, [200], (data) => ({ template: emailTemplateIn(data.data, locale), live: true }))
  },
}
