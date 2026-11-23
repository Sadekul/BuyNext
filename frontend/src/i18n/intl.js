/*
 * Phase 13: which locale numbers, money and dates are written in.
 *
 * A tiny store outside React (like utils/displayCurrency.js), because the
 * formatters (utils/formatters.js) are plain functions called from
 * components, reducers and strings alike. i18n/index.js sets the language
 * here whenever it changes; the store settings set `bangla_digits`.
 *
 *   English            → en-US              "$1,250.00", "Apr 30, 2026"
 *   Bangla             → bn-BD              "৳১,২৫০.০০", "৩০ এপ্রিল, ২০২৬"
 *   Bangla, no digits  → bn-BD-u-nu-latn    "৳1,250.00", "30 এপ্রিল, 2026"
 */

export const SUPPORTED_LANGUAGES = ['en', 'bn']
export const DEFAULT_LANGUAGE = 'en'

let language = DEFAULT_LANGUAGE
let banglaDigits = true

/** 'bn' for "bn", "bn-BD", "BN"…; 'en' for "en-US"…; null for anything else. */
export function normalizeLanguage(value) {
  if (typeof value !== 'string') return null
  const base = value.trim().toLowerCase().split(/[-_]/)[0]
  return SUPPORTED_LANGUAGES.includes(base) ? base : null
}

export const getIntlLanguage = () => language

export function setIntlLanguage(value) {
  language = normalizeLanguage(value) ?? DEFAULT_LANGUAGE
}

/** Store setting `bangla_digits` (default true): Bangla digits ০–৯ when the language is Bangla. */
export function setBanglaDigits(value) {
  banglaDigits = value !== false
}

export const getBanglaDigits = () => banglaDigits

/** The BCP 47 locale for Intl: en-US, bn-BD, or bn-BD-u-nu-latn (Bangla words, Latin digits). */
export function intlLocale(lng = language) {
  if (normalizeLanguage(lng) !== 'bn') return 'en-US'
  return banglaDigits ? 'bn-BD' : 'bn-BD-u-nu-latn'
}

const numberFormats = new Map()
function numberFormat(locale, options = {}) {
  const key = `${locale}|${JSON.stringify(options)}`
  if (!numberFormats.has(key)) numberFormats.set(key, new Intl.NumberFormat(locale, options))
  return numberFormats.get(key)
}

/** 12345 → "12,345" (English) or "১২,৩৪৫" (Bangla). Non-numbers are returned as they came. */
export function formatNumber(value, options) {
  const number = typeof value === 'number' ? value : Number(value)
  if (value === null || value === undefined || value === '' || !Number.isFinite(number)) return value ?? ''
  return numberFormat(intlLocale(), options).format(number)
}

/**
 * A count written the way the active language writes digits, WITHOUT
 * grouping changes for English (so "1234" stays "1234" in English, as the
 * English text always showed it). Used by the i18next `number` formatter.
 */
export function formatCount(value) {
  if (language !== 'bn') return value === null || value === undefined ? '' : String(value)
  return formatNumber(value)
}

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯'

/** "Step 2 of 3" style digits inside an already-built string: Latin → Bangla when the language uses them. */
export function localizeDigits(text) {
  if (language !== 'bn' || !banglaDigits || text === null || text === undefined) return text
  return String(text).replace(/[0-9]/g, (digit) => BANGLA_DIGITS[Number(digit)])
}

/** Tests: back to English with Bangla digits on. */
export function resetIntlForTests() {
  language = DEFAULT_LANGUAGE
  banglaDigits = true
  numberFormats.clear()
}
