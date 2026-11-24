/*
 * Phase 14 (docs/backend/PHASE14_CONTRACT.md): Bangladesh addresses, delivery
 * zones and cash on delivery, between the browser's camelCase and the API's
 * snake_case. Used by shop/laravel.js (carts, orders) and shop/customer.js
 * (the address book). Only listed fields go either way, like everywhere else.
 *
 * Nothing here changes an answer for other countries: every key is added only
 * when the API sent it (or, browser → API, only for a Bangladesh address).
 */

const str = (value) => (typeof value === 'string' ? value : undefined)
const money = (value) => (value === null || value === undefined || value === '' ? null : Number(value))
const positiveId = (value) => {
  const id = Number.isInteger(value) ? value : /^\d{1,9}$/.test(String(value ?? '').trim()) ? Number.parseInt(String(value).trim(), 10) : NaN
  return Number.isInteger(id) && id > 0 ? id : undefined
}
const wholeDays = (value) => {
  const days = Number(value)
  return Number.isInteger(days) && days >= 0 && days <= 365 ? days : null
}

/** "Bangladesh" (the store's country names) or "BD". */
export const isBangladesh = (country) => {
  const value = str(country)?.trim().toLowerCase()
  return value === 'bangladesh' || value === 'bd'
}

// ---- browser → API ----

/** { divisionId, districtId, areaId } of a Bangladesh address → { division_id, district_id, area_id } (only the valid ones). */
export function toPlaceIds(source) {
  if (!source || typeof source !== 'object') return {}
  const ids = { division_id: positiveId(source.divisionId), district_id: positiveId(source.districtId), area_id: positiveId(source.areaId) }
  return Object.fromEntries(Object.entries(ids).filter(([, value]) => value !== undefined))
}

/** The extra keys of a Bangladesh address (its place ids); nothing for other countries. */
export const toBangladeshAddress = (address) => (address && isBangladesh(address.country) ? toPlaceIds(address) : {})

// ---- API → browser ----

/**
 * A place as an address names it: { id, name, name_en, name_bn } → { id, name, nameEn, nameBn };
 * a bare name (an order's `area: "Dhanmondi"`, English) → { id, name, nameEn, nameBn: null }.
 */
export function fromPlace(raw, id) {
  if (typeof raw === 'string' && raw.trim()) return { id: id ?? null, name: raw.trim(), nameEn: raw.trim(), nameBn: null }
  if (raw && typeof raw === 'object') {
    const nameEn = str(raw.name_en) ?? str(raw.name) ?? ''
    return { id: positiveId(raw.id) ?? id ?? null, name: str(raw.name) ?? nameEn, nameEn, nameBn: str(raw.name_bn) ?? str(raw.bn_name) ?? null }
  }
  return null
}

/**
 * An address's Bangladesh keys: the place ids, and the places with their
 * names in both languages (the page shows the reader's). The API may name
 * them as objects (`area: { id, name_en, name_bn }`) or flat (`area_name`,
 * `area_name_bn`).
 */
export function fromBangladeshAddress(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const result = {}
  for (const level of ['division', 'district', 'area']) {
    const id = positiveId(raw[`${level}_id`]) ?? positiveId(raw[level]?.id)
    if (id === undefined) continue
    result[`${level}Id`] = id
    const place =
      fromPlace(raw[level], id) ??
      (str(raw[`${level}_name`]) ? fromPlace({ id, name: raw[`${level}_name`], name_en: raw[`${level}_name_en`] ?? raw[`${level}_name`], name_bn: raw[`${level}_name_bn`] ?? raw[`${level}_bn_name`] }) : null)
    if (place) result[level] = place
  }
  return result
}

/**
 * A delivery zone ({ code, name (request language), name_en, name_bn }, or just its code) →
 * { code, name, nameEn, nameBn }, or null.
 */
export function fromZone(raw, code, name = null) {
  if (raw && typeof raw === 'object' && str(raw.code)) {
    return { code: raw.code.slice(0, 60), name: str(raw.name) ?? str(raw.name_en) ?? raw.code, nameEn: str(raw.name_en) ?? null, nameBn: str(raw.name_bn) ?? str(raw.bn_name) ?? null }
  }
  const only = str(code)
  return only ? { code: only.slice(0, 60), name: str(name) ?? null, nameEn: null, nameBn: null } : null
}

/** A delivery method's zone and delivery time in days (phase 14 zone rates). */
export function fromMethodDelivery(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const min = wholeDays(raw.eta_days_min)
  const max = wholeDays(raw.eta_days_max)
  const zone = fromZone(raw.zone, raw.zone_code)
  return {
    ...(min !== null && { etaDaysMin: min }),
    ...(max !== null && { etaDaysMax: max }),
    ...(zone && { zone }),
  }
}

// Why cash on delivery can't be chosen: not in the address's zone, over the limit, or no area chosen yet (zones set).
const COD_REASONS = ['zone', 'limit', 'area_required']

/**
 * Cash on delivery for this cart: whether it can be chosen (and why not), the
 * COD fee, and the advance (the delivery charge paid online first).
 */
export function fromCod(raw) {
  if (!raw || typeof raw !== 'object') return null
  const reason = str(raw.reason) ?? str(raw.code)
  return {
    available: raw.available !== false,
    reason: reason && COD_REASONS.includes(reason) ? reason : reason ? 'other' : null,
    message: str(raw.message)?.slice(0, 300) ?? null,
    fee: money(raw.fee) ?? 0,
    maxOrderTotal: money(raw.max_order_total),
    advance: raw.advance === 'delivery_charge' ? 'delivery_charge' : 'none',
    advanceAmount: money(raw.advance_amount),
    // "0.00" when the store takes no advance: nothing to pay first.
    ...(money(raw.due_on_delivery ?? raw.cod_due) !== null && { dueOnDelivery: money(raw.due_on_delivery ?? raw.cod_due) }),
    requiresConfirmation: raw.require_confirmation === true || raw.requires_confirmation === true,
  }
}

/** Totals' COD keys: the COD fee, the advance paid, and what is collected on delivery. */
export function fromCodTotals(raw = {}) {
  return {
    ...(raw.cod_fee !== undefined && raw.cod_fee !== null && { codFee: money(raw.cod_fee) ?? 0 }),
    ...(raw.advance_paid !== undefined && raw.advance_paid !== null && { advancePaid: money(raw.advance_paid) ?? 0 }),
    ...(raw.cod_due !== undefined && raw.cod_due !== null && { codDue: money(raw.cod_due) ?? 0 }),
  }
}

const CONFIRMATION_STATUSES = ['pending', 'confirmed', 'unreachable', 'cancelled']

const moneyKey = (key, value) => (value !== undefined && value !== null && value !== '' ? { [key]: money(value) ?? 0 } : {})

/**
 * An order's phase 14 keys (the API's `delivery: { zone_code, zone_name, eta_days_min, eta_days_max, eta }`
 * and `cod: { fee, advance_amount, advance_paid, cod_due }`): zone, COD fee, the advance (to pay, and
 * paid), the cash due on delivery, and the phone confirmation.
 */
export function fromOrderDelivery(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const delivery = raw.delivery && typeof raw.delivery === 'object' ? raw.delivery : {}
  const zone = fromZone(raw.delivery_zone, delivery.zone_code ?? raw.delivery_zone_code, delivery.zone_name)
  const cod = raw.cod && typeof raw.cod === 'object' ? raw.cod : raw
  return {
    ...(zone && { deliveryZone: zone }),
    ...moneyKey('codFee', cod.fee ?? cod.cod_fee),
    ...(Number(cod.advance_amount) > 0 && moneyKey('advanceAmount', cod.advance_amount)),
    ...moneyKey('advancePaid', cod.advance_paid),
    ...moneyKey('codDue', cod.cod_due),
    ...(CONFIRMATION_STATUSES.includes(raw.confirmation_status) && { confirmationStatus: raw.confirmation_status }),
  }
}

/** The order's delivery time in days (`delivery.eta_days_min/max`), for its delivery method. */
export const fromOrderEta = (raw) => fromMethodDelivery({ eta_days_min: raw?.delivery?.eta_days_min, eta_days_max: raw?.delivery?.eta_days_max })
