import { currentLanguage, translate } from '../i18n'
import { localizeDigits } from '../i18n/intl'

/*
 * Phase 14 (docs/backend/PHASE14_CONTRACT.md §2–§4): Bangladesh addresses,
 * mobile numbers, delivery zones and cash on delivery, as plain helpers.
 *
 * The Bangladesh address form (Division → District → Area) is used only for
 * an address in Bangladesh, in a store whose API knows Bangladesh's places
 * (store settings `bangladeshAddresses`). Every other address, and the demo,
 * keep the fields they always had.
 */

/** "Bangladesh" (the store's country names) or "BD". */
export const isBangladesh = (country) => {
  const value = typeof country === 'string' ? country.trim().toLowerCase() : ''
  return value === 'bangladesh' || value === 'bd'
}

/** Whether this address uses the Bangladesh form (Division → District → Area). */
export const usesBangladeshForm = (country, settings) => settings?.bangladeshAddresses === true && isBangladesh(country)

/** Whether a saved or ordered address is a Bangladesh address with its places (ids from the API). */
export const isBangladeshAddress = (address) => Boolean(address && isBangladesh(address.country) && (address.areaId || address.area))

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯'

/** "০১৭১২" → "01712": Bangla digits typed on a Bangla keyboard count as digits. */
export const toLatinDigits = (value) => String(value ?? '').replace(/[০-৯]/g, (digit) => String(BANGLA_DIGITS.indexOf(digit)))

/*
 * Bangladeshi mobile numbers: 01XXXXXXXXX, +8801XXXXXXXXX or 8801XXXXXXXXX,
 * with spaces or dashes; operator prefixes 013 to 019. The API stores them as
 * +8801XXXXXXXXX and checks them again.
 */
const compactPhone = (value) => toLatinDigits(value).trim().replace(/[\s().-]/g, '')

/** The 11-digit local form (01XXXXXXXXX), or null when it isn't shaped like a Bangladeshi mobile. */
function localMobile(value) {
  const compact = compactPhone(value)
  const local = compact.replace(/^(?:\+|00)?880(?=1)/, '0')
  return /^01\d{9}$/.test(local) ? local : null
}

/** null when fine, else why not: 'required' | 'format' | 'operator'. */
export function bdMobileProblem(value) {
  if (!compactPhone(value)) return 'required'
  const local = localMobile(value)
  if (!local) return 'format'
  if (!/^01[3-9]/.test(local)) return 'operator'
  return null
}

/** "01712-345678" → "+8801712345678" (null when it isn't a valid Bangladeshi mobile). */
export const normalizeBdMobile = (value) => (bdMobileProblem(value) === null ? `+880${localMobile(value).slice(1)}` : null)

/** The message for a mobile number that isn't right (validation:bd.mobile.*), or null. */
export const bdMobileMessage = (value) => {
  const problem = bdMobileProblem(value)
  return problem ? translate(`validation:bd.mobile.${problem}`) : null
}

/** A place's name in the reader's language: { nameEn, nameBn } (or the API's { name_en, name_bn }). */
export function placeName(place) {
  if (!place) return ''
  const english = place.nameEn ?? place.name_en ?? place.name ?? ''
  const bangla = place.nameBn ?? place.name_bn ?? null
  return currentLanguage() === 'bn' && bangla ? bangla : english
}

/** The postcode to suggest for an area: its only postcode, else null (several, or none known). */
export function suggestedPostcode(area) {
  const codes = Array.isArray(area?.postcodes) ? [...new Set(area.postcodes.map((code) => String(code)).filter((code) => /^\d{4}$/.test(code)))] : []
  return codes.length === 1 ? codes[0] : null
}

/** "Delivery in 1–2 days" / "১–২ দিনে ডেলিভারি" from a method's days, or null when it has none. */
export function etaText(method) {
  const min = Number.isInteger(method?.etaDaysMin) ? method.etaDaysMin : null
  const max = Number.isInteger(method?.etaDaysMax) ? method.etaDaysMax : min
  const low = min ?? max
  if (low === null) return null
  if (max === null || max === low) return translate('checkout:delivery.etaDays', { count: low })
  return translate('checkout:delivery.etaRange', { min: low, max })
}

/** A delivery zone's name in the reader's language ({ code, name, nameBn }), or ''. */
export function zoneName(zone) {
  if (!zone) return ''
  if (currentLanguage() === 'bn' && zone.nameBn) return zone.nameBn
  if (zone.name) return zone.name
  return translate(`checkout:delivery.zones.${zone.code}`, { defaultValue: zone.code })
}

/**
 * "Inside Dhaka · Delivery in 1–2 days": what a delivery method says under
 * its name, or null. The cart's zone (named in both languages) wins over the
 * method's bare zone code when they are the same zone.
 */
export function zoneDeliveryText(method, cartZone = null) {
  const zone = cartZone && (!method?.zone || method.zone.code === cartZone.code) ? cartZone : (method?.zone ?? null)
  return [zoneName(zone), etaText(method)].filter(Boolean).join(' · ') || null
}

/**
 * Why cash on delivery can't be chosen for this cart, in the shopper's
 * language. `format` writes money in the store currency.
 */
export function codUnavailableText(cod, { format, zone } = {}) {
  if (!cod || cod.available !== false) return null
  if (cod.reason === 'zone') {
    const name = zoneName(zone)
    return name ? translate('checkout:cod.notInZone', { zone: name }) : translate('checkout:cod.notInArea')
  }
  if (cod.reason === 'area_required') return translate('checkout:cod.areaRequired')
  if (cod.reason === 'limit' && cod.maxOrderTotal !== null && cod.maxOrderTotal !== undefined && format) {
    return translate('checkout:cod.overLimit', { amount: format(cod.maxOrderTotal) })
  }
  return cod.message ?? translate('checkout:cod.unavailable')
}

/** Whether cash on delivery is refused for this cart (not just waiting for the area to be chosen). */
export const codRefused = (cod) => Boolean(cod && cod.available === false && cod.reason !== 'area_required')

/**
 * The place lines of an address, in the reader's language. Bangladesh:
 * "Dhanmondi, Dhaka 1209" and "Dhaka Division"; elsewhere the usual
 * "Springfield, Oregon 29112".
 */
export function addressPlaceLines(address) {
  if (!address) return []
  if (isBangladeshAddress(address)) {
    const area = placeName(address.area) || address.city
    const district = placeName(address.district) || address.city
    const division = placeName(address.division) || address.state
    const postcode = address.postalCode ? localizeDigits(address.postalCode) : ''
    const first = [[area, area === district ? null : district].filter(Boolean).join(', '), postcode].filter(Boolean).join(' ')
    return [first, division ? translate('common:bdAddress.divisionLine', { name: division }) : null].filter(Boolean)
  }
  return [`${address.city}, ${address.state} ${address.postalCode}`]
}
