import { laravel, laravelRaw } from '../http.js'
import { failed } from './adminSystem.js'
import { camelPath } from './laravel.js'

/*
 * Phase 18 admin data from BuyNest's Laravel API (docs/backend/PHASE18_CONTRACT.md
 * §1 "Endpoints"): couriers (Steadfast and Pathao) and their settings, Pathao's
 * cities, zones and areas, booking a courier from an order (one or many), and
 * asking the courier for a parcel's status. Only listed fields go either way
 * (never a courier secret); snake_case becomes camelCase, money strings numbers.
 * Every call resolves to { ok: true, status, data } or { ok: false, status, body }.
 */

export const COURIERS = ['steadfast', 'pathao']
export const DELIVERY_STATUSES = ['booked', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'partly_delivered', 'on_hold', 'returned', 'cancelled', 'shipped']
const EVENT_SOURCES = ['booking', 'webhook', 'sync', 'staff']
const MODES = ['sandbox', 'live']

const str = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)
const short = (value, max) => str(value)?.slice(0, max) ?? null
const money = (value) => (value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null)
const int = (value) => (Number.isInteger(value) ? value : typeof value === 'string' && /^\d{1,12}$/.test(value) ? Number(value) : null)
const httpsUrl = (value) => (typeof value === 'string' && /^https?:\/\/[^\s"'<>]+$/.test(value) ? value : null)
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null)
const listOf = (data) => (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [])
const deliveryStatus = (value) => (DELIVERY_STATUSES.includes(value) ? value : null)

// ---- 422 field names: the API's → the admin's ----

const FIELD_NAMES = {
  courier_default: 'defaultCourier',
  courier_auto_sync: 'autoSync',
  courier_note_template: 'noteTemplate',
  courier_pathao_item_type: 'pathaoItemType',
  courier_pathao_delivery_type: 'pathaoDeliveryType',
  cod_amount: 'codAmount',
  weight_kg: 'weightKg',
  notify_customer: 'notifyCustomer',
  confirmation_override: 'confirmationOverride',
  recipient_city: 'pathaoCityId',
  recipient_zone: 'pathaoZoneId',
  recipient_area: 'pathaoAreaId',
  'pathao.city_id': 'pathaoCityId',
  'pathao.zone_id': 'pathaoZoneId',
  'pathao.area_id': 'pathaoAreaId',
  'pathao.delivery_type': 'pathaoDeliveryType',
  'pathao.item_type': 'pathaoItemType',
}
export const fieldName = (field) => FIELD_NAMES[field] ?? (/^numbers(\.\d+)?$/.test(field) ? 'numbers' : camelPath(field))
const fail = (result) => failed(result, fieldName)
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : fail(result))
const call = (path, token, request, options = {}) => laravel(`/api/admin/v1${path}`, { token, request, ...options })

/*
 * A booking waits for the courier (the API gives it 20 s, plus the connection),
 * longer than the usual 15 s: these POSTs get their own timeout, so a slow
 * courier isn't reported as a failure while the booking still goes through.
 */
const BOOKING_TIMEOUT = 60_000
// Up to 50 orders, each its own courier call.
export const BULK_TIMEOUT = 300_000
const post = (path, token, request, body, timeout) =>
  laravelRaw(`/api/admin/v1${path}`, { request, bytes: JSON.stringify(body), contentType: 'application/json', headers: { Authorization: `Bearer ${token}` }, timeout })

// ---- shipments ----

/** A shipment's courier booking (AdminShipmentResource `courier`), or null for a manual shipment. */
export function shipmentCourier(raw) {
  const courier = objectOf(raw)
  if (!courier) return null
  return {
    key: str(courier.key),
    label: short(courier.label, 60) ?? str(courier.key) ?? '',
    consignmentId: short(courier.consignment_id, 60),
    trackingCode: short(courier.tracking_code, 60),
    bookedViaApi: courier.booked_via_api === true,
    courierStatus: short(courier.courier_status, 60),
    deliveryStatus: deliveryStatus(courier.delivery_status) ?? 'shipped',
    deliveryStatusLabel: short(courier.delivery_status_label, 60),
    codAmount: money(courier.cod_amount),
    courierFee: money(courier.courier_fee),
    collected: money(courier.collected),
    statusUpdatedAt: str(courier.status_updated_at),
    lastSyncedAt: str(courier.last_synced_at),
  }
}

/** One step of a parcel's timeline. */
export function shipmentEvent(raw = {}) {
  return {
    deliveryStatus: deliveryStatus(raw.delivery_status) ?? 'in_transit',
    label: short(raw.label, 60),
    courierStatus: short(raw.courier_status, 60),
    message: short(raw.message, 500),
    source: EVENT_SOURCES.includes(raw.source) ? raw.source : 'sync',
    occurredAt: str(raw.occurred_at),
  }
}

/**
 * A shipment's phase 18 fields: the courier booking, its normalised delivery
 * status, and the events. Old answers (before phase 18): nothing, so the
 * shipment looks as it did.
 */
export function shipmentPhase18(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const fields = {}
  if (raw.courier !== undefined) fields.courier = shipmentCourier(raw.courier)
  const status = deliveryStatus(raw.courier?.delivery_status) ?? deliveryStatus(raw.delivery_status)
  if (status) {
    fields.deliveryStatus = status
    fields.deliveryStatusLabel = short(raw.courier?.delivery_status_label ?? raw.delivery_status_label, 60)
  }
  if (Array.isArray(raw.events)) fields.events = raw.events.slice(0, 200).map(shipmentEvent)
  return fields
}

/** An order grid row's latest delivery status (only when the API sent one). */
export function orderRowPhase18(raw) {
  const status = deliveryStatus(raw?.delivery_status)
  return status ? { deliveryStatus: status, deliveryStatusLabel: short(raw.delivery_status_label, 60) } : {}
}

// ---- couriers and settings ----

/** A courier as the admin sees it: never a key or secret, only whether it is set up. */
export function courierInfo(raw = {}) {
  return {
    key: str(raw.key),
    label: short(raw.label, 60) ?? str(raw.key) ?? '',
    configured: raw.configured === true,
    mode: MODES.includes(raw.mode) ? raw.mode : null,
    balance: short(raw.balance, 60),
    webhookUrl: httpsUrl(raw.webhook_url),
  }
}

// The API names the settings as stored (courier_default…); the short names are accepted too.
const setting = (raw, name) => raw?.[`courier_${name}`] ?? raw?.[name]
export function courierSettings(raw) {
  const settings = objectOf(raw) ?? {}
  const preferred = setting(settings, 'default') ?? settings.default_courier
  const itemType = setting(settings, 'pathao_item_type')
  const deliveryType = setting(settings, 'pathao_delivery_type')
  return {
    defaultCourier: COURIERS.includes(preferred) ? preferred : null,
    autoSync: setting(settings, 'auto_sync') !== false,
    noteTemplate: short(setting(settings, 'note_template'), 200),
    pathaoItemType: ['parcel', 'document'].includes(itemType) ? itemType : 'parcel',
    pathaoDeliveryType: ['normal', 'on_demand'].includes(deliveryType) ? deliveryType : 'normal',
  }
}

/** The admin's settings values (already checked) → the API's names. */
export function toSettingsBody(values) {
  const body = {}
  if (values.defaultCourier !== undefined) body.courier_default = values.defaultCourier
  if (values.autoSync !== undefined) body.courier_auto_sync = values.autoSync
  if (values.noteTemplate !== undefined) body.courier_note_template = values.noteTemplate
  if (values.pathaoItemType !== undefined) body.courier_pathao_item_type = values.pathaoItemType
  if (values.pathaoDeliveryType !== undefined) body.courier_pathao_delivery_type = values.pathaoDeliveryType
  return body
}

// ---- Pathao's places ----

/** A Pathao city, zone or area ({ id, name } or { city_id, city_name }…). */
export function pathaoPlace(raw = {}, level) {
  const singular = { cities: 'city', zones: 'zone', areas: 'area' }[level]
  return {
    id: int(raw.id ?? raw[`${singular}_id`]),
    name: short(raw.name ?? raw[`${singular}_name`], 120) ?? '',
    ...(level === 'areas' && {
      homeDelivery: raw.home_delivery_available !== false,
      pickup: raw.pickup_available !== false,
    }),
  }
}

// ---- booking ----

/** GET orders/:number/courier-booking → the booking dialog's defaults. */
export function bookingDefaults(raw) {
  const data = objectOf(raw) ?? {}
  const match = objectOf(data.pathao_match) ?? {}
  const couriers = (Array.isArray(data.couriers) ? data.couriers : [])
    .map((entry) => (typeof entry === 'string' ? { key: entry, label: null, mode: null } : { key: str(entry?.key), label: short(entry?.label, 60), mode: MODES.includes(entry?.mode) ? entry.mode : null }))
    .filter((entry) => COURIERS.includes(entry.key))
  return {
    defaultCourier: COURIERS.includes(data.courier_default) ? data.courier_default : null,
    couriers,
    codAmount: money(data.cod_amount) ?? 0,
    weightKg: money(data.weight_kg),
    note: short(data.note, 200),
    phone: short(data.phone, 20),
    addressLine: short(data.address_line, 300),
    pathaoMatch: { cityId: int(match.city_id), zoneId: int(match.zone_id), areaId: int(match.area_id) },
    // Why the order can't be booked now (store currency, no courier, already booked, not shippable), or null.
    problem: short(data.problem, 300),
    awaitsConfirmation: data.awaits_confirmation === true,
  }
}

/** The admin's booking values (already checked) → the API's body. */
export function toBookingBody(values) {
  return {
    courier: values.courier,
    ...(values.codAmount !== undefined && { cod_amount: values.codAmount }),
    ...(values.weightKg !== undefined && { weight_kg: values.weightKg }),
    ...(values.note !== undefined && { note: values.note }),
    ...(values.notifyCustomer !== undefined && { notify_customer: values.notifyCustomer }),
    ...(values.confirmationOverride !== undefined && { confirmation_override: values.confirmationOverride }),
    ...(values.pathao && {
      pathao: {
        city_id: values.pathao.cityId,
        zone_id: values.pathao.zoneId,
        ...(values.pathao.areaId && { area_id: values.pathao.areaId }),
        ...(values.pathao.deliveryType && { delivery_type: values.pathao.deliveryType }),
        ...(values.pathao.itemType && { item_type: values.pathao.itemType }),
      },
    }),
  }
}

/** The bulk booking's answer: which orders were booked, which not and why. */
export function bulkResult(raw) {
  const data = objectOf(raw) ?? {}
  return {
    booked: (Array.isArray(data.booked) ? data.booked : []).map((entry) => ({ number: str(entry?.number), consignmentId: short(entry?.consignment_id, 60), trackingCode: short(entry?.tracking_code, 60) })).filter((entry) => entry.number),
    failed: (Array.isArray(data.failed) ? data.failed : []).map((entry) => ({ number: str(entry?.number), message: short(entry?.message, 300) ?? 'The courier refused it.' })).filter((entry) => entry.number),
  }
}

// ---- the calls ----

export const laravelPhase18Data = {
  /** → { couriers, settings }; ?balance=1 asks Steadfast for its balance (cached by the API). */
  async couriers(token, withBalance, request) {
    return answer(await call(`/couriers${withBalance ? '?balance=1' : ''}`, token, request), [200], (data) => ({
      couriers: listOf(data).map(courierInfo).filter((entry) => entry.key),
      settings: courierSettings(data?.settings),
      live: true,
    }))
  },
  async updateSettings(token, values, request) {
    const result = await call('/couriers/settings', token, request, { method: 'PUT', body: toSettingsBody(values) })
    return answer(result, [200], (data) => ({ settings: courierSettings(data?.settings ?? data?.data?.settings ?? data?.data ?? data), live: true }))
  },

  /** level: cities | zones (of a city) | areas (of a zone). */
  async pathaoPlaces(token, level, parent, request) {
    const path = level === 'cities' ? '/couriers/pathao/cities' : level === 'zones' ? `/couriers/pathao/cities/${parent}/zones` : `/couriers/pathao/zones/${parent}/areas`
    return answer(await call(path, token, request), [200], (data) => ({ options: listOf(data).map((entry) => pathaoPlace(entry, level)).filter((entry) => entry.id !== null), live: true }))
  },

  async bookingDefaults(token, number, request) {
    return answer(await call(`/orders/${number}/courier-booking`, token, request), [200], (data) => ({ booking: bookingDefaults(data?.data ?? data), live: true }))
  },
  /** → 201 { shipment }, mapped by the caller's `mapShipment`. */
  async book(token, number, values, mapShipment, request) {
    const result = await post(`/orders/${number}/courier-booking`, token, request, toBookingBody(values), BOOKING_TIMEOUT)
    return answer(result, [200, 201], (data) => ({ shipment: mapShipment(data?.data ?? {}), live: true }))
  },
  async bookMany(token, courier, numbers, request) {
    const result = await post('/orders/courier-bookings', token, request, { courier, numbers }, BULK_TIMEOUT)
    return answer(result, [200], (data) => ({ ...bulkResult(data?.data ?? data), live: true }))
  },
  async sync(token, number, mapShipment, request) {
    const result = await post(`/shipments/${number}/sync`, token, request, {}, BOOKING_TIMEOUT)
    return answer(result, [200], (data) => ({ shipment: mapShipment(data?.data ?? {}), live: true }))
  },
}
