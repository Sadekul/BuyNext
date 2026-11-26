import { json, readBody } from './http.js'
import { checkConfirmationOverride } from './adminPhase14Api.js'
import { adminShipmentDetail } from './shop/adminSales.js'
import { COURIERS, DELIVERY_STATUSES, laravelPhase18Data } from './shop/adminPhase18.js'

/*
 * Phase 18 admin routes and rules (docs/backend/PHASE18_CONTRACT.md §1
 * "Endpoints"): courier integration with Steadfast and Pathao. BuyNest's
 * Laravel API only. Matched by adminApi.js before its own routes, so the
 * admin session check there runs first; the API checks the role's
 * permission (orders.view, settings.edit, shipments.create) and answers
 * 403 { code: "permission_denied", permission }, passed on unchanged.
 * The couriers' webhooks go straight to the API, never through here.
 *
 * COURIERS (orders.view; the settings part needs settings.view or orders.view):
 *   GET    /api/admin/couriers[?balance=1]                → { couriers: [{ key, label, configured, mode: sandbox|live|null, balance: "৳ …"|null, webhookUrl }],
 *                                                          settings: { defaultCourier, autoSync, noteTemplate, pathaoItemType, pathaoDeliveryType } }
 *   PUT    /api/admin/couriers/settings                   (settings.edit) { defaultCourier: null|steadfast|pathao, autoSync, noteTemplate (≤ 200, null),
 *                                                          pathaoItemType: parcel|document, pathaoDeliveryType: normal|on_demand } (any of them) → { settings }
 *
 * PATHAO'S PLACES (shipments.create; 422 when Pathao isn't set up, 502 { message } when it can't be reached):
 *   GET    /api/admin/couriers/pathao/cities              → { options: [{ id, name }] }
 *   GET    /api/admin/couriers/pathao/cities/:id/zones    → { options: [{ id, name }] }
 *   GET    /api/admin/couriers/pathao/zones/:id/areas     → { options: [{ id, name, homeDelivery, pickup }] }
 *
 * BOOKING (shipments.create):
 *   GET    /api/admin/orders/:number/courier-booking      → { booking: { defaultCourier, couriers: [{ key, label, mode }], codAmount, weightKg, note,
 *                                                          phone, addressLine, pathaoMatch: { cityId, zoneId, areaId }, problem (why it can't be booked now) | null,
 *                                                          awaitsConfirmation } }
 *   POST   /api/admin/orders/:number/courier-booking      { courier, codAmount?, weightKg?, note?, notifyCustomer?, confirmationOverride?,
 *                                                          pathao?: { cityId, zoneId, areaId?, deliveryType?, itemType? } } → 201 { shipment }
 *   POST   /api/admin/orders/courier-bookings             { courier: steadfast, numbers (1–50) } → { booked: [{ number, consignmentId, trackingCode }],
 *                                                          failed: [{ number, message }] }
 *   POST   /api/admin/shipments/:number/sync              → { shipment } (asks the courier now; 422 for a manual shipment)
 *
 * The rest rides on existing routes:
 *   shipments (order detail, Shipments list and page)     + courier: { key, label, consignmentId, trackingCode, bookedViaApi, courierStatus, deliveryStatus,
 *                                                            deliveryStatusLabel, codAmount, courierFee, collected, statusUpdatedAt, lastSyncedAt } | null,
 *                                                            deliveryStatus, deliveryStatusLabel, events: [{ deliveryStatus, label, courierStatus, message,
 *                                                            source, occurredAt }] (only when the API sends them)
 *   GET orders?delivery=STATUS                             the grid's filter (delivery_status); rows + deliveryStatus, deliveryStatusLabel (latest shipment)
 *   carriers                                               + steadfast, pathao, redx, paperfly, sundarban (manual shipments, shipments filter)
 */

const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const LIVE_ONLY = 'This needs the BuyNest backend; the demo data has no couriers.'
const live = (handler) => (ctx) => (realData() ? handler(ctx) : json({ message: LIVE_ONLY }, 404))
const fromLaravel = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))
const invalid = (errors) => json({ message: 'Please check the highlighted fields.', errors }, 422)

const isOrderNumber = (value) => typeof value === 'string' && /^BN-\d{1,12}$/.test(value)
const isShipmentNumber = (value) => typeof value === 'string' && /^SHP-\d{1,12}$/.test(value)
const isIdText = (value) => /^\d{1,9}$/.test(value ?? '')
const isId = (value) => Number.isInteger(value) && value > 0 && value < 1e9
const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const isMoney = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100_000_000 && hasCents(value)
const isText = (value, max) => typeof value === 'string' && value.trim().length <= max
const has = (body, key) => body[key] !== undefined && body[key] !== null
export const MAX_BULK = 50
export const MANUAL_CARRIERS = ['steadfast', 'pathao', 'redx', 'paperfly', 'sundarban']

/** ?delivery=STATUS of the order grid → the API's filter (only a known status). */
export const orderPhase18Filters = (url) => {
  const status = url.searchParams.get('delivery')
  return DELIVERY_STATUSES.includes(status) ? { delivery_status: status } : {}
}

// ---- shapes the browser sends ----

export function validateCourierSettings(body) {
  const errors = {}
  const values = {}
  if (body.defaultCourier !== undefined) {
    if (body.defaultCourier === null || body.defaultCourier === '') values.defaultCourier = null
    else if (COURIERS.includes(body.defaultCourier)) values.defaultCourier = body.defaultCourier
    else errors.defaultCourier = ['Choose Steadfast, Pathao, or no default.']
  }
  if (body.autoSync !== undefined) {
    if (typeof body.autoSync === 'boolean') values.autoSync = body.autoSync
    else errors.autoSync = ['Choose yes or no.']
  }
  if (body.noteTemplate !== undefined) {
    if (body.noteTemplate === null || (typeof body.noteTemplate === 'string' && body.noteTemplate.trim() === '')) values.noteTemplate = null
    else if (isText(body.noteTemplate, 200)) values.noteTemplate = body.noteTemplate.trim()
    else errors.noteTemplate = ['Keep the note to 200 characters.']
  }
  if (body.pathaoItemType !== undefined) {
    if (['parcel', 'document'].includes(body.pathaoItemType)) values.pathaoItemType = body.pathaoItemType
    else errors.pathaoItemType = ['Choose parcel or document.']
  }
  if (body.pathaoDeliveryType !== undefined) {
    if (['normal', 'on_demand'].includes(body.pathaoDeliveryType)) values.pathaoDeliveryType = body.pathaoDeliveryType
    else errors.pathaoDeliveryType = ['Choose normal or on-demand delivery.']
  }
  if (Object.keys(values).length === 0 && Object.keys(errors).length === 0) errors.defaultCourier = ['Change at least one setting.']
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

export function validateBooking(body) {
  const errors = {}
  const values = {}
  if (COURIERS.includes(body.courier)) values.courier = body.courier
  else errors.courier = ['Choose a courier.']
  if (has(body, 'codAmount')) {
    if (isMoney(body.codAmount)) values.codAmount = body.codAmount
    else errors.codAmount = ['Enter the cash to collect: 0 or more, with at most 2 decimals.']
  }
  if (has(body, 'weightKg')) {
    if (typeof body.weightKg === 'number' && Number.isFinite(body.weightKg) && body.weightKg > 0 && body.weightKg <= 50) values.weightKg = Math.round(body.weightKg * 1000) / 1000
    else errors.weightKg = ['Enter the weight in kg, more than 0 and at most 50.']
  }
  if (body.note !== undefined) {
    if (body.note === null || (typeof body.note === 'string' && body.note.trim() === '')) values.note = null
    else if (isText(body.note, 200)) values.note = body.note.trim()
    else errors.note = ['Keep the note to 200 characters.']
  }
  if (typeof body.notifyCustomer === 'boolean') values.notifyCustomer = body.notifyCustomer
  // Phase 14 §4: an unconfirmed cash on delivery order needs a reason (3–500 characters).
  checkConfirmationOverride(body, values, errors)
  if (values.courier === 'pathao') {
    const pathao = body.pathao && typeof body.pathao === 'object' ? body.pathao : {}
    if (!isId(pathao.cityId)) errors.pathaoCityId = ['Choose the city.']
    if (!isId(pathao.zoneId)) errors.pathaoZoneId = ['Choose the zone.']
    if (pathao.areaId !== undefined && pathao.areaId !== null && !isId(pathao.areaId)) errors.pathaoAreaId = ['Choose the area from the list.']
    if (pathao.deliveryType !== undefined && !['normal', 'on_demand'].includes(pathao.deliveryType)) errors.pathaoDeliveryType = ['Choose normal or on-demand delivery.']
    if (pathao.itemType !== undefined && !['parcel', 'document'].includes(pathao.itemType)) errors.pathaoItemType = ['Choose parcel or document.']
    values.pathao = {
      cityId: pathao.cityId,
      zoneId: pathao.zoneId,
      ...(isId(pathao.areaId) && { areaId: pathao.areaId }),
      ...(pathao.deliveryType && { deliveryType: pathao.deliveryType }),
      ...(pathao.itemType && { itemType: pathao.itemType }),
    }
  }
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

export function validateBulkBooking(body) {
  const errors = {}
  // Pathao needs a city and zone per order: bulk booking is Steadfast only.
  if (body.courier !== 'steadfast') errors.courier = ['Only Steadfast can book several orders at once.']
  const numbers = body.numbers
  if (!Array.isArray(numbers) || numbers.length < 1 || numbers.length > MAX_BULK || !numbers.every(isOrderNumber) || new Set(numbers).size !== numbers.length) errors.numbers = [`Choose 1 to ${MAX_BULK} orders.`]
  return Object.keys(errors).length > 0 ? { errors } : { values: { courier: body.courier, numbers } }
}

// ---- the routes ----

const PHASE18_ROUTES = {
  'GET couriers': live(async (ctx) => fromLaravel(await laravelPhase18Data.couriers(ctx.token, ctx.url.searchParams.get('balance') === '1', ctx.request))),
  'PUT couriers/settings': live(async (ctx) => {
    const { values, errors } = validateCourierSettings(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase18Data.updateSettings(ctx.token, values, ctx.request))
  }),
  'GET couriers/pathao/:level': live(async (ctx) => fromLaravel(await laravelPhase18Data.pathaoPlaces(ctx.token, ctx.id, ctx.sub, ctx.request))),

  'GET orders/:id/courier-booking': live(async (ctx) => fromLaravel(await laravelPhase18Data.bookingDefaults(ctx.token, ctx.id, ctx.request))),
  'POST orders/:id/courier-booking': live(async (ctx) => {
    const { values, errors } = validateBooking(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase18Data.book(ctx.token, ctx.id, values, adminShipmentDetail, ctx.request), 201)
  }),
  'POST orders/courier-bookings': live(async (ctx) => {
    const { values, errors } = validateBulkBooking(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase18Data.bookMany(ctx.token, values.courier, values.numbers, ctx.request), 200)
  }),
  'POST shipments/:id/sync': live(async (ctx) => fromLaravel(await laravelPhase18Data.sync(ctx.token, ctx.id, adminShipmentDetail, ctx.request), 200)),
}

/**
 * The phase 18 routes in adminApi.js's matcher: { route, id, sub } for one of
 * them, null for a malformed address of theirs (404), undefined when not theirs.
 */
export function matchPhase18Route(method, segments) {
  const [first, second, third, fourth, fifth, ...rest] = segments
  if (first === 'couriers') {
    if (second === undefined) return { route: PHASE18_ROUTES[`${method} couriers`] }
    if (second === 'settings' && third === undefined) return { route: PHASE18_ROUTES[`${method} couriers/settings`] }
    if (second !== 'pathao' || rest.length > 0) return null
    const route = PHASE18_ROUTES[`${method} couriers/pathao/:level`]
    if (third === 'cities' && fourth === undefined) return { route, id: 'cities' }
    if (third === 'cities' && isIdText(fourth) && fifth === 'zones') return { route, id: 'zones', sub: fourth }
    if (third === 'zones' && isIdText(fourth) && fifth === 'areas') return { route, id: 'areas', sub: fourth }
    return null
  }
  if (first === 'orders') {
    if (second === 'courier-bookings' && third === undefined) return { route: PHASE18_ROUTES[`${method} orders/courier-bookings`] }
    if (isOrderNumber(second) && third === 'courier-booking' && fourth === undefined) return { route: PHASE18_ROUTES[`${method} orders/:id/courier-booking`], id: second }
    return undefined
  }
  if (first === 'shipments' && isShipmentNumber(second) && third === 'sync' && fourth === undefined) return { route: PHASE18_ROUTES[`${method} shipments/:id/sync`], id: second }
  return undefined
}
