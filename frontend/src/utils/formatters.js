import { STORE_SETTINGS } from '../constants/store'

const currencyFormatter = new Intl.NumberFormat(STORE_SETTINGS.locale, {
  style: 'currency',
  currency: STORE_SETTINGS.currency,
})

/** Formats a number as a localized price, e.g. 1099.99 → "$1,099.99". */
export function formatPrice(amount) {
  return currencyFormatter.format(amount)
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
