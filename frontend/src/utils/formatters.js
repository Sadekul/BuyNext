import { STORE_SETTINGS } from '../constants/store'
import { getDisplayCurrency } from './displayCurrency'

const currencyFormatter = new Intl.NumberFormat(STORE_SETTINGS.locale, {
  style: 'currency',
  currency: STORE_SETTINGS.currency,
})

/*
 * Prices: ONE formatter for every shopper-facing price (phase 11 §5).
 *   formatPrice(amount)      in the shopper's display currency (converted and
 *                            rounded for display only), or the base currency.
 *   formatBasePrice(amount)  always the base currency: what is CHARGED. Used
 *                            by checkout, orders, invoices, and gift cards.
 * With no display currency chosen (the default, and always in the demo) the two are the same.
 */

/** Formats a base-currency amount as a localized price, e.g. 1099.99 → "$1,099.99". */
export function formatBasePrice(amount) {
  return currencyFormatter.format(amount)
}

const displayFormatters = new Map()
function displayFormatter(currency) {
  const key = `${currency.code}:${currency.decimals}`
  if (!displayFormatters.has(key)) {
    const digits = { minimumFractionDigits: currency.decimals, maximumFractionDigits: currency.decimals }
    let formatter
    try {
      formatter = new Intl.NumberFormat(STORE_SETTINGS.locale, { style: 'currency', currency: currency.code, ...digits })
    } catch {
      formatter = new Intl.NumberFormat(STORE_SETTINGS.locale, digits) // a code Intl doesn't know: number only
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
  return hasCurrency ? text : `${currency.symbol}${text}`
}

/** Formats a price for display: the shopper's chosen currency, or the base currency, e.g. 1099.99 → "$1,099.99". */
export function formatPrice(amount) {
  const currency = getDisplayCurrency()
  return currency ? formatInCurrency(amount, currency) : currencyFormatter.format(amount)
}

const dateFormatter = new Intl.DateTimeFormat(STORE_SETTINGS.locale, { dateStyle: 'medium' })

/** ISO date string → "Apr 30, 2025". */
export function formatDate(isoDate) {
  return dateFormatter.format(new Date(isoDate))
}

/** "mens-watches" → "Mens Watches" (the same format the categories API uses). */
export function formatSlug(slug) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

const dateTimeFormatter = new Intl.DateTimeFormat(STORE_SETTINGS.locale, { dateStyle: 'medium', timeStyle: 'short' })

/** ISO date-time → "Nov 10, 2026, 9:41 AM" (in the shopper's time zone). */
export function formatDateTime(isoDate) {
  return dateTimeFormatter.format(new Date(isoDate))
}
