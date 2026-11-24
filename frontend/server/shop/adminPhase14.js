import { laravel, laravelFile, laravelPdf } from '../http.js'
import { failed } from './adminSystem.js'
import { camelPath } from './laravel.js'

/*
 * Phase 14 admin data from BuyNest's Laravel API (docs/backend/PHASE14_CONTRACT.md
 * and its "Implementation notes — backend"): Bangladesh places, delivery
 * zones, the zone and cash on delivery fields of orders, the phone
 * confirmation queue, packing slip PDFs, and the courier CSV. Only listed
 * fields go either way; snake_case becomes camelCase, money strings numbers.
 * Every call resolves to { ok: true, status, data } or { ok: false, status, body }.
 */

const str = (value) => (typeof value === 'string' && value !== '' ? value : null)
const money = (value) => (value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null)
const int = (value) => (Number.isInteger(value) ? value : typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : null)
const days = (value) => {
  const number = int(value)
  return number !== null && number <= 365 ? number : null
}
const listOf = (data) => (Array.isArray(data?.data) ? data.data : [])
const call = (path, token, request, options = {}) => laravel(`/api/admin/v1${path}`, { token, request, ...options })

// ---- 422 field names: the API's → the admin's ----

const FIELD_NAMES = { bn_name: 'nameBn', is_active: 'isActive', is_fallback: 'isFallback', collected_amount: 'collectedAmount', confirmation_override: 'confirmationOverride' }
export const fieldName = (field) => {
  if (/^(district_ids|area_ids)(\.\d+)?$/.test(field)) return 'places'
  return FIELD_NAMES[field] ?? camelPath(field)
}
const fail = (result) => failed(result, fieldName)
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : fail(result))

// ---- §1 places ----

const KINDS = ['upazila', 'thana']
/** A place of the public places API → { id, name (English), nameBn, divisionId?, districtId?, kind?, cityCorporation?, postcodes? }. */
export function place(raw) {
  return {
    id: int(raw?.id),
    name: str(raw?.name_en) ?? str(raw?.name) ?? '',
    nameBn: str(raw?.name_bn),
    ...(raw?.division_id !== undefined && { divisionId: int(raw.division_id) }),
    ...(raw?.district_id !== undefined && { districtId: int(raw.district_id) }),
    ...(raw?.kind !== undefined && { kind: KINDS.includes(raw.kind) ? raw.kind : 'upazila' }),
    ...(raw?.city_corporation !== undefined && { cityCorporation: str(raw.city_corporation) }),
    ...(raw?.postcodes !== undefined && { postcodes: (Array.isArray(raw.postcodes) ? raw.postcodes : []).filter((code) => typeof code === 'string' && /^\d{4}$/.test(code)) }),
  }
}

// ---- §3 delivery zones ----

/** A zone → the admin's: its districts and areas as one list of places. */
export function deliveryZone(raw = {}) {
  const districts = Array.isArray(raw.districts) ? raw.districts : []
  const areas = Array.isArray(raw.areas) ? raw.areas : []
  return {
    id: raw.id,
    code: str(raw.code) ?? '',
    name: str(raw.name) ?? str(raw.code) ?? '',
    nameBn: str(raw.bn_name) ?? str(raw.name_bn),
    position: int(raw.position) ?? 0,
    isActive: raw.is_active !== false,
    isFallback: raw.is_fallback === true,
    places: [
      ...districts.map((district) => ({ districtId: int(district.id), areaId: null, name: str(district.name) })),
      ...areas.map((area) => ({ areaId: int(area.id), districtId: null, name: str(area.name), districtName: str(area.district_name) })),
    ],
    rateCount: int(raw.rates_count),
  }
}

/** The admin's zone values → the API's body (places → district_ids and area_ids, replacing the zone's). */
export function toZoneBody(values) {
  const body = {}
  if (values.code !== undefined) body.code = values.code
  if (values.name !== undefined) body.name = values.name
  if (values.nameBn !== undefined) body.bn_name = values.nameBn
  if (values.position !== undefined) body.position = values.position
  if (values.isActive !== undefined) body.is_active = values.isActive
  if (values.isFallback !== undefined) body.is_fallback = values.isFallback
  if (values.places !== undefined) {
    body.district_ids = values.places.filter((entry) => entry.districtId).map((entry) => entry.districtId)
    body.area_ids = values.places.filter((entry) => entry.areaId).map((entry) => entry.areaId)
  }
  return body
}

// ---- §3 and §4 on orders ----

const CONFIRMATION_STATUSES = ['pending', 'confirmed', 'unreachable', 'cancelled']
const OUTCOMES = ['confirmed', 'unreachable', 'cancelled', 'note', 'override']
const zoneRef = (code, name, nameBn) => (str(code) ? { code: str(code).slice(0, 60), name: str(name) ?? str(code), nameBn: str(nameBn) } : null)

/**
 * An order's (or grid row's) phase 14 fields: delivery zone and time, the COD
 * fee, advance and cash to collect, and the phone confirmation (with its log
 * on the detail answer). Old answers: nothing.
 */
export function orderPhase14(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const delivery = raw.delivery && typeof raw.delivery === 'object' ? raw.delivery : null
  const cod = raw.cod && typeof raw.cod === 'object' ? raw.cod : null
  const confirmation = raw.confirmation && typeof raw.confirmation === 'object' ? raw.confirmation : null
  const zone = delivery ? zoneRef(delivery.zone_code, delivery.zone_name, delivery.zone_name_bn) : (raw.delivery_zone && typeof raw.delivery_zone === 'object' ? zoneRef(raw.delivery_zone.code, raw.delivery_zone.name, raw.delivery_zone.name_bn) : zoneRef(raw.delivery_zone_code))
  const status = confirmation?.status ?? raw.confirmation_status
  const fields = {}
  if (zone) fields.deliveryZone = zone
  if (delivery) {
    fields.etaDaysMin = days(delivery.eta_days_min)
    fields.etaDaysMax = days(delivery.eta_days_max)
  }
  if (cod) {
    fields.codFee = money(cod.fee) ?? 0
    fields.advanceAmount = money(cod.advance_amount) ?? 0
    fields.advancePaid = money(cod.advance_paid) ?? 0
    fields.codDue = money(cod.cod_due) ?? 0
    const collected = money(cod.collected)
    fields.codCollection = collected !== null && collected > 0 ? { amount: collected } : null
  } else if (raw.cod_due !== undefined && raw.cod_due !== null) fields.codDue = money(raw.cod_due) ?? 0
  if (CONFIRMATION_STATUSES.includes(status)) fields.confirmationStatus = status
  if (confirmation && CONFIRMATION_STATUSES.includes(confirmation.status)) {
    fields.confirmation = {
      status: confirmation.status,
      attempts: int(confirmation.attempts) ?? 0,
      confirmedAt: str(confirmation.confirmed_at),
      log: (Array.isArray(confirmation.logs) ? confirmation.logs : []).map((entry) => ({
        id: entry.id ?? null,
        outcome: OUTCOMES.includes(entry.outcome) ? entry.outcome : 'note',
        note: str(entry.note)?.slice(0, 1000) ?? null,
        adminName: str(entry.admin_name),
        createdAt: str(entry.created_at),
      })),
    }
  }
  return fields
}

/** A stored Bangladesh order address names its area in English (`area`): kept as the address's area. */
export function addressArea(address, raw) {
  if (!address || !raw || typeof raw !== 'object' || typeof raw.area !== 'string' || raw.area === '') return address
  return { ...address, area: { id: int(raw.area_id), name: raw.area, nameEn: raw.area, nameBn: null } }
}

/** A row of Sales → To confirm. */
export function toConfirmRow(raw = {}) {
  const previous = raw.previous && typeof raw.previous === 'object' ? raw.previous : null
  return {
    number: raw.number,
    placedAt: str(raw.placed_at),
    status: str(raw.status),
    paymentStatus: str(raw.payment_status),
    currency: typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : undefined,
    total: money(raw.grand_total) ?? 0,
    codDue: money(raw.cod_due),
    advancePaid: money(raw.advance_paid) ?? 0,
    customerName: str(raw.customer_name) ?? '',
    phone: str(raw.phone),
    email: str(raw.email),
    address: str(raw.address)?.slice(0, 500) ?? null,
    deliveryZone: raw.delivery_zone && typeof raw.delivery_zone === 'object' ? zoneRef(raw.delivery_zone.code, raw.delivery_zone.name) : null,
    confirmationStatus: CONFIRMATION_STATUSES.includes(raw.confirmation_status) ? raw.confirmation_status : 'pending',
    attempts: int(raw.confirmation_attempts) ?? 0,
    lastNote: str(raw.last_note)?.slice(0, 500) ?? null,
    lastAttemptAt: str(raw.last_attempt_at),
    history: previous ? { orders: int(previous.orders) ?? 0, delivered: int(previous.delivered) ?? 0, cancelled: int(previous.cancelled) ?? 0, returns: int(previous.returns) ?? 0 } : null,
  }
}

// ---- the calls ----

export const laravelPhase14Data = {
  /** level: divisions | districts | areas; parent: the division or district id. */
  async places(token, level, parent, request) {
    const params = level === 'districts' && parent ? `?division=${parent}` : level === 'areas' ? `?district=${parent}` : ''
    const result = await laravel(`/api/v1/places/bd/${level}${params}`, { token, request, language: 'en' })
    return answer(result, [200], (data) => ({ places: listOf(data).map(place).filter((entry) => entry.id !== null), live: true }))
  },

  async listZones(token, request) {
    return answer(await call('/delivery-zones', token, request), [200], (data) => ({ zones: listOf(data).map(deliveryZone), live: true }))
  },
  async createZone(token, values, request) {
    return answer(await call('/delivery-zones', token, request, { method: 'POST', body: toZoneBody(values) }), [200, 201], (data) => ({ zone: deliveryZone(data?.data), live: true }))
  },
  async updateZone(token, id, values, request) {
    return answer(await call(`/delivery-zones/${id}`, token, request, { method: 'PATCH', body: toZoneBody(values) }), [200], (data) => ({ zone: deliveryZone(data?.data), live: true }))
  },
  async deleteZone(token, id, request) {
    return answer(await call(`/delivery-zones/${id}`, token, request, { method: 'DELETE' }), [200, 204], () => ({ deleted: true, live: true }))
  },
  /** The API has no reorder call: each zone whose place changed gets its new position. */
  async reorderZones(token, ids, request) {
    const current = await call('/delivery-zones', token, request)
    if (current.status !== 200) return fail(current)
    const zones = listOf(current.data).map(deliveryZone)
    const known = new Set(zones.map((zone) => zone.id))
    if (ids.length !== zones.length || !ids.every((id) => known.has(id))) return { ok: false, status: 422, body: { message: 'Please check the highlighted fields.', errors: { ids: ['Send every zone once, in the new order.'] } } }
    for (const [position, id] of ids.entries()) {
      if (zones.find((zone) => zone.id === id).position === position) continue
      const result = await call(`/delivery-zones/${id}`, token, request, { method: 'PATCH', body: { position } })
      if (result.status !== 200) return fail(result)
    }
    return this.listZones(token, request)
  },

  async toConfirm(token, { limit, skip }, request) {
    const params = new URLSearchParams({ page: String(Math.floor(skip / limit) + 1), per_page: String(limit) })
    return answer(await call(`/orders/to-confirm?${params}`, token, request), [200], (data) => ({
      orders: listOf(data).map(toConfirmRow),
      total: data?.meta?.total ?? listOf(data).length,
      limit,
      skip,
      live: true,
    }))
  },
  /** → { order } (the order with its confirmation), mapped by the caller's `mapOrder`. */
  async recordConfirmation(token, number, values, mapOrder, request) {
    const body = {
      outcome: values.outcome,
      ...(values.note && { note: values.note }),
      ...(values.reason && { reason: values.reason }),
      ...(values.notifyCustomer !== undefined && { notify_customer: values.notifyCustomer }),
    }
    return answer(await call(`/orders/${number}/confirmation`, token, request, { method: 'POST', body }), [200, 201], (data) => ({ order: mapOrder(data?.data ?? {}), live: true }))
  },

  packingSlipPdf(token, number, request) {
    return laravelPdf(`/api/admin/v1/orders/${number}/packing-slip.pdf`, { token, request })
  },
  packingSlipsPdf(token, numbers, request) {
    return laravelPdf('/api/admin/v1/orders/packing-slips', { token, request, method: 'POST', body: { numbers } })
  },
  courierCsv(token, query, request) {
    return laravelFile(`/api/admin/v1/orders/export/courier.csv?${query}`, { token, request })
  },
}


