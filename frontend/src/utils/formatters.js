import { getIntlLanguage, intlLocale, localizeDigits } from '../i18n/intl'
import { getDisplayCurrency, getStoreCurrency, sanitizeStoreCurrency } from './displayCurrency'

/*
 * Prices: ONE formatter for every shopper-facing price (phase 11 §5).
 *   formatPrice(amount)      in the shopper's display currency (converted and
 *                            rounded for display only), or the base currency.
 *   formatBasePrice(amount)  always the base currency: what is CHARGED. Used
 *                            by checkout, orders, invoices, and gift cards.
 * With no display currency chosen (the default, and always in the demo) the two are the same.
 *
 * Phase 12: the base currency is the STORE currency (GET /store `currency`:
 * USD, or BDT → "৳1,250.00"), USD until the settings load. Money that
 * belongs to an order (or an invoice, a refund, a gift card) is written in
 * ITS currency: formatBasePrice(amount, order.currency), so an old USD
 * order still reads "$" after the store switched to taka.
 *
 * Phase 13: money keeps the phase 12 layout in both languages (symbol first,
 * groups of three, like the API's emails and PDFs); in Bangla the digits are
 * Bangla ("৳১,২৫০.০০") unless the store turned them off ("৳1,250.00"). Dates
 * and plain numbers use Intl in the active locale (i18n/intl.js): en-US,
 * bn-BD, or bn-BD-u-nu-latn.
 */

/** The currency to write money in: the given one (an order's code), else the store currency. */
function chargedCurrency(currency) {
  const own = currency ? sanitizeStoreCurrency(currency) : null
  const storeCurrency = getStoreCurrency()
  // The store's own code keeps the store's symbol and decimals from the settings.
  if (!own || own.code === storeCurrency.code) return storeCurrency
  return own
}

/**
 * Formats an amount in the currency it was charged in, e.g. 1099.99 → "$1,099.99"
 * (or "৳1,099.99" in a taka store). `currency` (optional): a code or
 * { code, symbol, decimals }, for an order's own money; the store currency otherwise.
 */
export function formatBasePrice(amount, currency) {
  return formatInCurrency(amount, { ...chargedCurrency(currency), rate: 1 })
}

/** A formatter bound to one currency (an order's), for components that take `format`. */
export const moneyFormatter = (currency) => (amount) => formatBasePrice(amount, currency)

/** The code of what is charged: the given currency's, else the store's ("USD" until the settings load). */
export const chargedCurrencyCode = (currency) => chargedCurrency(currency).code

const displayFormatters = new Map()
function displayFormatter(currency) {
  // Phase 13: money is always laid out the en-US way (symbol first, groups of three), in every
  // language, exactly like the API's emails and PDFs; Bangla only swaps the digits (formatInCurrency).
  const key = `${currency.code}:${currency.decimals}`
  if (!displayFormatters.has(key)) {
    const digits = { minimumFractionDigits: currency.decimals, maximumFractionDigits: currency.decimals }
    let formatter
    try {
      formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.code, ...digits })
    } catch {
      formatter = new Intl.NumberFormat('en-US', digits) // a code Intl doesn't know: number only
    }
    displayFormatters.set(key, formatter)
  }
  return displayFormatters.get(key)
}

/** A base amount in another currency: converted at `rate`, rounded to its decimals. */
export function convertPrice(amount, currency) {
  const factor = 10 ** currency.decimals
  return Math.round(amount * currency.rate * factor) / factor
}

/** "৳1,234.50": the store's own symbol in place of whatever Intl would write ("BDT"). */
export function formatInCurrency(amount, currency) {
  const parts = displayFormatter(currency).formatToParts(convertPrice(amount, currency))
  const hasCurrency = parts.some((part) => part.type === 'currency')
  const text = parts
    .filter((part) => part.type !== 'literal' || !hasCurrency || part.value.trim() !== '')
    .map((part) => (part.type === 'currency' ? currency.symbol : part.value))
    .join('')
  // Bangla (phase 13): the same layout with Bangla digits ("৳১,২৫০.০০"; "৳1,250.00" when the store turned them off).
  return localizeDigits(hasCurrency ? text : `${currency.symbol}${text}`)
}

/** Formats a price for display: the shopper's chosen currency, or the base currency, e.g. 1099.99 → "$1,099.99". */
export function formatPrice(amount) {
  const currency = getDisplayCurrency()
  return currency ? formatInCurrency(amount, currency) : formatBasePrice(amount)
}

const dateFormatters = new Map()
/** One Intl.DateTimeFormat per locale and style (Bangla spells the month out: "৩০ এপ্রিল, ২০২৬"). */
function dateFormatter(style) {
  const locale = intlLocale()
  const key = `${locale}:${style}`
  if (!dateFormatters.has(key)) {
    const bangla = getIntlLanguage() === 'bn'
    const options = style === 'date' ? { dateStyle: bangla ? 'long' : 'medium' } : { dateStyle: bangla ? 'long' : 'medium', timeStyle: 'short' }
    dateFormatters.set(key, new Intl.DateTimeFormat(locale, options))
  }
  return dateFormatters.get(key)
}

/** ISO date string → "Apr 30, 2025" (Bangla: "৩০ এপ্রিল, ২০২৫"). */
export function formatDate(isoDate) {
  return dateFormatter('date').format(new Date(isoDate))
}

/** 12345 → "12,345" in the active language (Bangla digits in Bangla). */
export { formatNumber } from '../i18n/intl'

/** "mens-watches" → "Mens Watches" (the same format the categories API uses). */
export function formatSlug(slug) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** ISO date-time → "Nov 10, 2026, 9:41 AM" (in the shopper's time zone). */
export function formatDateTime(isoDate) {
  return dateFormatter('dateTime').format(new Date(isoDate))
}
