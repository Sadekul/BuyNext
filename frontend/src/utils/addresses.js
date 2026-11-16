/*
 * Address-book helpers (REAL_SHOP). A saved address has the order address's
 * fields (firstName … country) plus id, phone, company, and the two default flags.
 */

export const ORDER_ADDRESS_FIELDS = ['firstName', 'lastName', 'line1', 'line2', 'city', 'state', 'postalCode', 'country']

/** A saved address → the checkout form's address (only the order fields). */
export const toOrderAddress = (saved) => Object.fromEntries(ORDER_ADDRESS_FIELDS.map((field) => [field, saved?.[field] ?? '']))

const normalized = (value) => String(value ?? '').trim().toLowerCase()

/** True when two addresses have the same order fields (ignoring case and spaces at the ends). */
export const isSameAddress = (a, b) => ORDER_ADDRESS_FIELDS.every((field) => normalized(a?.[field]) === normalized(b?.[field]))

/** "Ava Guest, 12 Market Street, Springfield, Oregon 29112, United States": one line, for pickers. */
export function addressSummary(address) {
  const name = [address.firstName, address.lastName].filter(Boolean).join(' ')
  const place = [address.city, [address.state, address.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [name, address.line1, address.line2, place, address.country].filter(Boolean).join(', ')
}

/** The default shipping (or billing) address of a book, or null. */
export const defaultAddress = (addresses, kind) => addresses?.find((address) => (kind === 'billing' ? address.isDefaultBilling : address.isDefaultShipping)) ?? null

/** The most addresses one customer can keep (docs/backend/PHASE6_CONTRACT.md). */
export const MAX_SAVED_ADDRESSES = 20
