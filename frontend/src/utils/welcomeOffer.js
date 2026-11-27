import { formatNumber, localizeDigits } from '../i18n/intl'
import { formatBasePrice, formatInCurrency } from './formatters'
import { getStoreCurrency } from './displayCurrency'

/*
 * Phase 19 welcome coupon (docs/backend/PHASE19_CONTRACT.md §3).
 *
 * GET /store `welcome_offer` (null while the store owner hasn't switched it
 * on): { type: percent|fixed, value, label, min_subtotal, valid_days,
 * first_order_only, triggers: ["signup", "newsletter"] }. The storefront
 * promises the offer only where it is on (`triggers`) and never when it's
 * null: then every text stays exactly as before.
 *
 * The signed-in customer's own code (GET /me `welcome_coupon`, camelCased by
 * the sign-in service): { code, label, minSubtotal, expiresAt, status, firstOrderOnly? }.
 *
 * The offer is written from `type`/`value` in the active language and the
 * store currency (the store settings are cached for both languages, so the
 * API's own `label` may be in the other one); `label` is the fallback.
 */

export const WELCOME_TRIGGERS = ['signup', 'newsletter']
export const WELCOME_STATUSES = ['active', 'used', 'expired']

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : null)

/** GET /store `welcome_offer` → the offer, or null (off, or nothing a shopper could be told). */
export function normalizeWelcomeOffer(raw) {
  if (!raw || typeof raw !== 'object') return null
  const type = raw.type === 'percent' || raw.type === 'fixed' ? raw.type : null
  const value = Number(raw.value)
  const label = text(raw.label)
  const triggers = Array.isArray(raw.triggers) ? WELCOME_TRIGGERS.filter((trigger) => raw.triggers.includes(trigger)) : []
  const hasAmount = type !== null && Number.isFinite(value) && value > 0
  if (triggers.length === 0 || (!hasAmount && !label)) return null
  const validDays = Number(raw.valid_days)
  return {
    type: hasAmount ? type : null,
    value: hasAmount ? value : null,
    label,
    minSubtotal: text(raw.min_subtotal),
    validDays: Number.isInteger(validDays) && validDays > 0 ? validDays : null,
    firstOrderOnly: raw.first_order_only !== false,
    triggers,
  }
}

/** The signed-in customer's welcome code ({ code, label, minSubtotal, expiresAt, status }), or null. */
export function normalizeWelcomeCoupon(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.code !== 'string' || !raw.code.trim()) return null
  return {
    code: raw.code.trim(),
    label: text(raw.label),
    minSubtotal: text(raw.minSubtotal),
    expiresAt: text(raw.expiresAt),
    status: WELCOME_STATUSES.includes(raw.status) ? raw.status : 'active',
    ...(typeof raw.firstOrderOnly === 'boolean' && { firstOrderOnly: raw.firstOrderOnly }),
  }
}

/** The offer when it's on for this way of earning it ('signup' | 'newsletter'), else null. */
export const offerFor = (offer, trigger) => (offer && offer.triggers.includes(trigger) ? offer : null)

/** Money in the store currency, without ".00" for whole amounts: 100 → "৳100", 99.5 → "$99.50". */
export function formatOfferMoney(amount) {
  if (Number.isInteger(amount)) return formatInCurrency(amount, { ...getStoreCurrency(), decimals: 0, rate: 1 })
  return formatBasePrice(amount)
}

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯'
const latinDigits = (value) => value.replace(/[০-৯]/g, (digit) => String(BANGLA_DIGITS.indexOf(digit)))

/**
 * A minimum spend as the API sends it, a plain amount ("500.00") or already
 * formatted ("৳500", "৳১,০০০", "$12.50"): an amount with at most a currency
 * symbol is written again in the store currency and the active language's
 * digits; anything else is shown as given (its digits in the active language).
 */
export function formatMinimum(value) {
  if (value === null || value === undefined || value === '') return null
  const latin = latinDigits(String(value)).trim()
  const match = latin.match(/^[^\d\s.,]{0,3}\s?(\d[\d,]*(\.\d+)?)$/)
  if (match) return formatOfferMoney(Number(match[1].replace(/,/g, '')))
  return localizeDigits(String(value))
}

/** "10% off" / "৳100 off" in the active language (`t` from the marketing namespace). */
export function offerLabel(offer, t) {
  if (!offer) return ''
  if (offer.type === 'percent') return t('welcome.percentOff', { value: formatNumber(offer.value) })
  if (offer.type === 'fixed') return t('welcome.amountOff', { amount: formatOfferMoney(offer.value) })
  return localizeDigits(offer.label ?? '')
}

/** "Get 10% off your first order" (or "Get 10% off" when any order may use it). */
export const offerTitle = (offer, t) => t(offer.firstOrderOnly ? 'welcome.titleFirstOrder' : 'welcome.title', { offer: offerLabel(offer, t) })

/** "Orders over ৳500." or null. */
export function minimumLine(minSubtotal, t) {
  const minimum = formatMinimum(minSubtotal)
  return minimum ? t('welcome.minimum', { min: minimum }) : null
}
