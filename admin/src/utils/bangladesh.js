import { LuCircleCheck, LuCircleX, LuClock, LuPhoneMissed } from 'react-icons/lu'
import { formatCount } from './format'

/*
 * Phase 14 (docs/backend/PHASE14_CONTRACT.md): Bangladesh addresses and
 * mobile numbers, delivery zones and their delivery times, cash on delivery
 * and the phone confirmation of COD orders. The admin stays English; the
 * server has the final word on every rule checked here.
 */

/** The address is in Bangladesh: the country is "BD" or "Bangladesh" (Settings → Checkout uses names). */
export const isBangladesh = (country) => typeof country === 'string' && /^(bd|bangladesh)$/i.test(country.trim())

// ---- mobile numbers ----

/**
 * A Bangladeshi mobile number as typed (01XXXXXXXXX, +8801XXXXXXXXX,
 * 8801XXXXXXXXX, with spaces or dashes) → +8801XXXXXXXXX, or null when it
 * isn't one (operator prefixes 013 to 019).
 */
export function normalizeBdMobile(value) {
  if (typeof value !== 'string') return null
  const digits = value.trim().replace(/[\s-]/g, '')
  const match = /^(?:\+?88)?(01[3-9]\d{8})$/.exec(digits)
  return match ? `+88${match[1]}` : null
}
export const BD_MOBILE_MESSAGE = 'Enter a Bangladeshi mobile number, like 01712 345678 (013 to 019).'

/** +8801712345678 → "01712 345678" (how people say it in Bangladesh); anything else as it is. */
export function formatBdMobile(value) {
  const normalized = normalizeBdMobile(value ?? '')
  if (!normalized) return value ?? ''
  const local = normalized.slice(3)
  return `${local.slice(0, 5)} ${local.slice(5)}`
}

/** A number for a tel: link (digits and a leading +), or null. */
export const telHref = (value) => {
  const digits = typeof value === 'string' ? value.replace(/[^\d+]/g, '') : ''
  return /^\+?\d{6,16}$/.test(digits) ? `tel:${digits}` : null
}

// ---- places ----

/** A place of an address ({ id, name, nameEn, nameBn }) in English, or ''. */
export const placeName = (place) => place?.nameEn || place?.name || ''

/** "Mirpur (thana)" for a metro thana, the name for an upazila. */
export const areaLabel = (area) => (area?.kind === 'thana' ? `${area.name} (thana)` : (area?.name ?? ''))

/** The one postcode of an area, else null (several or none: nothing is suggested). */
export const suggestedPostcode = (area) => (Array.isArray(area?.postcodes) && area.postcodes.length === 1 ? area.postcodes[0] : null)

export const isBdPostcode = (value) => /^\d{4}$/.test(value)

// ---- delivery zones and times ----

/** Days → "Delivery in 1–2 days" / "Delivery in 3 days" / "Delivery within 5 days"; '' when unknown. */
export function etaText(minDays, maxDays) {
  const min = Number.isInteger(minDays) ? minDays : null
  const max = Number.isInteger(maxDays) ? maxDays : null
  const days = (count) => `${count} ${count === 1 ? 'day' : 'days'}`
  if (min !== null && max !== null) return min === max ? `Delivery in ${days(min)}` : `Delivery in ${min}–${days(max)}`
  if (max !== null) return `Delivery within ${days(max)}`
  if (min !== null) return `Delivery in ${days(min)} or more`
  return ''
}

/** The three zones the API seeds, for when the zone list can't be read (no settings permission). */
export const SEEDED_ZONES = [
  { code: 'inside_dhaka', name: 'Inside Dhaka' },
  { code: 'dhaka_suburbs', name: 'Dhaka suburbs' },
  { code: 'outside_dhaka', name: 'Outside Dhaka' },
]
export const zoneName = (code, zones = SEEDED_ZONES) => zones.find((zone) => zone.code === code)?.name ?? code ?? ''

/** A zone code: lower-case letters, digits, underscores (2 to 40), starting with a letter. */
export const isZoneCode = (value) => /^[a-z][a-z0-9_]{1,39}$/.test(value)

// ---- phone confirmation of cash on delivery orders ----

export const CONFIRMATION_STATUSES = {
  pending: { label: 'To confirm', tone: 'warning', icon: LuClock },
  unreachable: { label: "Couldn't reach", tone: 'warning', icon: LuPhoneMissed },
  confirmed: { label: 'Confirmed', tone: 'success', icon: LuCircleCheck },
  cancelled: { label: 'Cancelled at confirmation', tone: 'neutral', icon: LuCircleX },
}
export const confirmationStatus = (status) => CONFIRMATION_STATUSES[status] ?? { label: status ?? 'Unknown', tone: 'neutral', icon: LuClock }
/** Statuses that stop the order from being shipped (unless staff override with a reason). */
export const confirmationOf = (order) => order?.confirmation?.status ?? order?.confirmationStatus ?? null
export const awaitsConfirmation = (order) => ['pending', 'unreachable'].includes(confirmationOf(order))

/** A log entry's outcome in words. */
export const OUTCOMES = { confirmed: 'Confirmed', unreachable: "Couldn't reach", cancelled: 'Cancelled', note: 'Note', override: 'Shipped without confirmation' }
export const outcomeLabel = (outcome) => OUTCOMES[outcome] ?? outcome ?? ''

// ---- cash on delivery ----

export const isCod = (order) => order?.paymentMethod === 'cod'

/** What the courier still has to collect: the API's codDue, else the unpaid total of a COD order. */
export function amountToCollect(order) {
  if (!isCod(order)) return 0
  if (typeof order.codDue === 'number') return order.codDue
  if (['paid', 'partially_refunded', 'refunded'].includes(order.paymentStatus)) return 0
  return Math.max(Math.round(((order.totals?.total ?? order.total ?? 0) - (order.advancePaid ?? 0)) * 100), 0) / 100
}

export const COD_ADVANCE = {
  none: 'Nothing in advance: the whole amount is paid on delivery',
  delivery_charge: 'The delivery charge first, online (SSLCommerz); the rest on delivery',
}

/**
 * Whether SSLCommerz can take the advance now: it is ticked under
 * Checkout → Payment methods and its keys work (live, sandbox, or test).
 * → { ok, reason } (reason: why the advance can't be turned on).
 */
export function advanceAvailability(settings) {
  const enabled = (settings?.checkout?.enabledPaymentMethods ?? []).includes('sslcommerz')
  const status = settings?.store?.paymentProviders?.sslcommerz?.status
  if (!enabled) return { ok: false, reason: 'Taking the delivery charge in advance needs SSLCommerz: tick "bKash, Nagad, cards (SSLCommerz)" under Checkout → Payment methods first.' }
  if (status && !['live', 'sandbox', 'test'].includes(status)) {
    return { ok: false, reason: 'Taking the delivery charge in advance needs SSLCommerz, which is not set up on the server yet (its store ID and password). Without it, COD orders are paid in full on delivery.' }
  }
  return { ok: true, reason: null }
}

// ---- zones' places and customers' history ----

/** "Gulshan (thana), Dhaka" for an area, "Gazipur district" for a whole district. */
export function placeText(place) {
  if (place.areaId) return [place.name ? areaLabel({ name: place.name, kind: place.kind }) : `Area #${place.areaId}`, place.districtName].filter(Boolean).join(', ')
  return `${place.name || `District #${place.districtId}`} district`
}

/** "3 orders before: 2 delivered, 1 cancelled, 1 return" (or "First order"). */
export function historyText(history) {
  if (!history || !Number.isInteger(history.orders)) return null
  if (history.orders === 0) return 'First order'
  const parts = [
    Number.isInteger(history.delivered) && `${formatCount(history.delivered)} delivered`,
    history.cancelled > 0 && `${formatCount(history.cancelled)} cancelled`,
    history.returns > 0 && `${formatCount(history.returns)} ${history.returns === 1 ? 'return' : 'returns'}`,
  ].filter(Boolean)
  return `${formatCount(history.orders)} ${history.orders === 1 ? 'order' : 'orders'} before${parts.length ? `: ${parts.join(', ')}` : ''}`
}

