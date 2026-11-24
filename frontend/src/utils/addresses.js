import { addressPlaceLines, isBangladeshAddress } from './bangladesh'

/*
 * Address-book helpers (REAL_SHOP). A saved address has the order address's
 * fields (firstName … country) plus id, phone, company, and the two default flags.
 */

export const ORDER_ADDRESS_FIELDS = ['firstName', 'lastName', 'line1', 'line2', 'city', 'state', 'postalCode', 'country']

// Phase 14: a Bangladesh address also names its division, district and area (ids).
export const BANGLADESH_PLACE_FIELDS = ['divisionId', 'districtId', 'areaId']

/** A saved address → the checkout form's address (only the order fields; a Bangladesh address's place ids too). */
export const toOrderAddress = (saved) => ({
  ...Object.fromEntries(ORDER_ADDRESS_FIELDS.map((field) => [field, saved?.[field] ?? ''])),
  ...(saved?.areaId && Object.fromEntries(BANGLADESH_PLACE_FIELDS.map((field) => [field, String(saved[field] ?? '')]))),
})

const normalized = (value) => String(value ?? '').trim().toLowerCase()

/** True when two addresses have the same order fields (ignoring case and spaces at the ends; place ids too when both have them). */
export const isSameAddress = (a, b) =>
  ORDER_ADDRESS_FIELDS.every((field) => normalized(a?.[field]) === normalized(b?.[field])) &&
  (!a?.areaId || !b?.areaId || BANGLADESH_PLACE_FIELDS.every((field) => normalized(a?.[field]) === normalized(b?.[field])))

/** "Ava Guest, 12 Market Street, Springfield, Oregon 29112, United States": one line, for pickers. */
export function addressSummary(address) {
  const name = [address.firstName, address.lastName].filter(Boolean).join(' ')
  // Phase 14: a Bangladesh address names its area, district and division in the reader's language.
  const place = isBangladeshAddress(address)
    ? addressPlaceLines(address).join(', ')
    : [address.city, [address.state, address.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [name, address.line1, address.line2, place, address.country].filter(Boolean).join(', ')
}

/** The default shipping (or billing) address of a book, or null. */
export const defaultAddress = (addresses, kind) => addresses?.find((address) => (kind === 'billing' ? address.isDefaultBilling : address.isDefaultShipping)) ?? null

/** The most addresses one customer can keep (docs/backend/PHASE6_CONTRACT.md). */
export const MAX_SAVED_ADDRESSES = 20
