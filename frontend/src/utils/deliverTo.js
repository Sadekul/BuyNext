import { useSyncExternalStore } from 'react'
import { STORAGE_KEYS } from '../constants/storageKeys'
import { isBangladesh, placeName, suggestedPostcode } from './bangladesh'

/*
 * Phase 17 "Deliver to": the Bangladesh area the shopper chose in the header
 * (Division → District → Area), remembered in this browser only. It names the
 * delivery line in the top bar and pre-fills an empty Bangladesh address at
 * checkout. Storage may be blocked (private mode): every access is guarded,
 * and the choice then lasts until the page reloads.
 *
 * Stored as { divisionId, districtId, areaId, division, district, area } with
 * string ids and each place as { nameEn, nameBn } (the area also keeps its
 * postcodes), so it can be shown in either language without a request.
 */

const listeners = new Set()
let cache // undefined: not read yet

const isId = (value) => /^\d{1,9}$/.test(String(value ?? '')) && Number(value) > 0
const name = (value) => (typeof value === 'string' ? value.slice(0, 120) : '')

function cleanPlace(raw, { postcodes = false } = {}) {
  if (!raw || typeof raw !== 'object') return null
  const nameEn = name(raw.nameEn ?? raw.name_en ?? raw.name)
  if (!nameEn) return null
  const place = { nameEn, nameBn: name(raw.nameBn ?? raw.name_bn) || null }
  if (postcodes) place.postcodes = (Array.isArray(raw.postcodes) ? raw.postcodes : []).map(String).filter((code) => /^\d{4}$/.test(code)).slice(0, 20)
  return place
}

/** A choice with the right shape, or null. */
export function sanitizeDeliverTo(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (![raw.divisionId, raw.districtId, raw.areaId].every(isId)) return null
  const division = cleanPlace(raw.division)
  const district = cleanPlace(raw.district)
  const area = cleanPlace(raw.area, { postcodes: true })
  if (!division || !district || !area) return null
  return { divisionId: String(raw.divisionId), districtId: String(raw.districtId), areaId: String(raw.areaId), division, district, area }
}

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.deliverTo)
    return raw ? sanitizeDeliverTo(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

const emit = () => listeners.forEach((listener) => listener())

/** The remembered choice, or null. */
export function getDeliverTo() {
  if (cache === undefined) cache = readStored()
  return cache
}

/** Remembers a choice ({ divisionId, districtId, areaId, division, district, area }). Returns the saved choice or null. */
export function saveDeliverTo(choice) {
  const clean = sanitizeDeliverTo(choice)
  if (!clean) return null
  cache = clean
  try {
    window.localStorage.setItem(STORAGE_KEYS.deliverTo, JSON.stringify(clean))
  } catch {
    // Not remembered after a reload; it still applies on this page.
  }
  emit()
  return clean
}

/** Forgets the choice. */
export function clearDeliverTo() {
  cache = null
  try {
    window.localStorage.removeItem(STORAGE_KEYS.deliverTo)
  } catch {
    // Nothing stored anyway.
  }
  emit()
}

function subscribe(listener) {
  listeners.add(listener)
  // Another tab changed it: read it again.
  const onStorage = (event) => {
    if (event.key === null || event.key === STORAGE_KEYS.deliverTo) {
      cache = undefined
      listener()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** The remembered choice (re-renders when it changes, here or in another tab). */
export function useDeliverTo() {
  return useSyncExternalStore(subscribe, getDeliverTo, () => null)
}

/** Tests: forget the in-memory copy so the next read comes from storage. */
export function resetDeliverToForTests() {
  cache = undefined
}

/** "Banani, Dhaka" in the reader's language (the district is left out when it has the area's name). */
export function deliverToPlace(choice) {
  if (!choice) return ''
  const area = placeName(choice.area)
  const district = placeName(choice.district)
  return area === district ? area : [area, district].filter(Boolean).join(', ')
}

/**
 * The checkout's Bangladesh address with the remembered area filled in, when
 * the store uses the Bangladesh form, the address is in Bangladesh, and its
 * division, district and area are all still empty. The hidden city and state
 * follow the district and division (English), like the form does; the
 * postcode is filled only when the area has exactly one and none is typed.
 */
export function prefillDeliverTo(address, choice, settings) {
  if (!address || !choice || settings?.bangladeshAddresses !== true || !isBangladesh(address.country)) return address
  if (address.divisionId || address.districtId || address.areaId) return address
  const postcode = suggestedPostcode(choice.area)
  return {
    ...address,
    divisionId: choice.divisionId,
    districtId: choice.districtId,
    areaId: choice.areaId,
    state: choice.division.nameEn,
    city: choice.district.nameEn,
    ...(postcode && !address.postalCode && { postalCode: postcode }),
  }
}
