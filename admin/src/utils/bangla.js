/*
 * Phase 13 (docs/backend/PHASE13_CONTRACT.md §4): the store in Bangla (bn)
 * and English (en). The admin stays in English; staff type the Bangla texts
 * of products, categories, pages and home blocks next to the English ones.
 * An empty Bangla field is fine: shoppers using Bangla then see the English
 * text ("falls back to English").
 */

export const LANGUAGES = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'bn', label: 'Bangla', native: 'বাংলা' },
]

/** "Bangla (বাংলা)", "English"; null/unknown → the fallback. */
export function languageName(locale, fallback = '—') {
  const found = LANGUAGES.find((language) => language.id === locale)
  if (!found) return fallback
  return found.native === found.label ? found.label : `${found.label} (${found.native})`
}

/** The empty Bangla texts of a record (every field ''). */
export const emptyBangla = (fields) => Object.fromEntries(fields.map((field) => [field, '']))

/** A record's saved `bn` → the form's values (missing fields ''). */
export const banglaValues = (saved, fields) => Object.fromEntries(fields.map((field) => [field, typeof saved?.[field] === 'string' ? saved[field] : '']))

/** The form's Bangla texts → what is sent (trimmed; '' = not translated, falls back to English). HTML bodies kept as typed. */
export const toBangla = (values, fields, { raw = [] } = {}) => Object.fromEntries(fields.map((field) => [field, raw.includes(field) ? (values[field].trim() === '' ? '' : values[field]) : values[field].trim()]))

/** Whether two sets of texts differ (only changed Bangla texts are sent). */
export const banglaChanged = (a, b) => JSON.stringify(a) !== JSON.stringify(b)

/** How many of `fields` have a Bangla text, out of how many have an English one to translate. */
export function banglaProgress(bn, english, fields) {
  const needed = fields.filter((field) => String(english?.[field] ?? '').trim() !== '')
  const done = needed.filter((field) => String(bn?.[field] ?? '').trim() !== '')
  return { done: done.length, total: needed.length }
}

export const PRODUCT_BANGLA_FIELDS = ['name', 'shortDescription', 'description', 'metaTitle', 'metaDescription']
export const CATEGORY_BANGLA_FIELDS = ['name', 'description', 'metaTitle', 'metaDescription']
export const PAGE_BANGLA_FIELDS = ['title', 'body', 'metaTitle', 'metaDescription']
export const HERO_BANGLA_FIELDS = ['eyebrow', 'title', 'description', 'primaryCtaLabel', 'secondaryCtaLabel', 'imageAlt']
export const BANNER_BANGLA_FIELDS = ['eyebrow', 'title', 'description', 'ctaLabel', 'imageAlt']

/** The products grid's Bangla column: complete | missing. */
export const BANGLA_STATUSES = {
  complete: { tone: 'success', label: 'Complete' },
  missing: { tone: 'warning', label: 'Missing' },
}
