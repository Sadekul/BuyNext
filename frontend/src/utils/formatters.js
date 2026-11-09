import { STORE_SETTINGS } from '../constants/store'

const currencyFormatter = new Intl.NumberFormat(STORE_SETTINGS.locale, {
  style: 'currency',
  currency: STORE_SETTINGS.currency,
})

/** Formats a number as a localized price, e.g. 1099.99 → "$1,099.99". */
export function formatPrice(amount) {
  return currencyFormatter.format(amount)
}

/**
 * Applies a percentage discount and rounds to cents.
 * Display only: the backend must always calculate the real charged price.
 */
export function getDiscountedPrice(price, discountPercentage = 0) {
  return Math.round(price * (1 - discountPercentage / 100) * 100) / 100
}
