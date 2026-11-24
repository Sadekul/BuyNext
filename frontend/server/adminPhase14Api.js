import { json, readBody } from './http.js'
import { failed } from './shop/adminSystem.js'
import { adminOrderDetail } from './shop/admin.js'
import { fieldName, laravelPhase14Data } from './shop/adminPhase14.js'

/*
 * Phase 14 admin routes and rules (docs/backend/PHASE14_CONTRACT.md and its
 * implementation notes): Bangladesh delivery and cash on delivery. BuyNest's
 * Laravel API only. Matched by adminApi.js before its own routes, so the
 * admin session check there runs first; the API checks the role's
 * permission (settings.view/edit, orders.view/edit) and answers 403
 * { code: "permission_denied", permission }, passed on unchanged.
 *
 * PLACES (any admin; English names, Bangla too):
 *   GET    /api/admin/places/bd/divisions                → { places: [{ id, name, nameBn }] }
 *   GET    /api/admin/places/bd/districts?division=ID    → { places: [{ id, name, nameBn, divisionId }] }
 *   GET    /api/admin/places/bd/areas?district=ID        → { places: [{ id, name, nameBn, districtId, kind: upazila|thana, cityCorporation, postcodes }] }
 *
 * DELIVERY ZONES (read settings.view, change settings.edit):
 *   GET    /api/admin/delivery-zones                     → { zones: [Zone] }
 *            Zone = { id, code, name, nameBn, position, isActive, isFallback, rateCount,
 *                     places: [{ districtId, areaId: null, name } | { areaId, districtId: null, name, districtName }] }
 *   POST   /api/admin/delivery-zones                     { code, name, nameBn?, isActive?, isFallback?, places: [{ districtId } | { areaId }] } → 201 { zone }
 *   PATCH  /api/admin/delivery-zones/:id                 (the same but code, all optional; places replaces the list) → { zone }
 *   DELETE /api/admin/delivery-zones/:id                 → { deleted: true } (422 errors.zone: the fallback, or used by rates or COD)
 *   POST   /api/admin/delivery-zones/reorder             { ids } → { zones } (each moved zone's position is saved)
 *
 * PHONE CONFIRMATION (orders.edit):
 *   GET    /api/admin/orders/to-confirm?limit&skip       → { orders: [{ number, placedAt, status, paymentStatus, currency, total, codDue, advancePaid,
 *                                                          customerName, phone, email, address (one line), deliveryZone, confirmationStatus,
 *                                                          attempts, lastNote, lastAttemptAt, history: { orders, delivered, cancelled, returns } }], total }
 *   POST   /api/admin/orders/:number/confirmation        { outcome: confirmed|unreachable|cancelled, note?, reason? (cancelled), notifyCustomer? } → { order }
 *
 * COURIER FILES (orders.view):
 *   GET    /api/admin/orders/:number/packing-slip.pdf    → the PDF
 *   POST   /api/admin/orders/packing-slips               { numbers (1–100) } → one PDF
 *   GET    /api/admin/orders/export/courier.csv?numbers=BN-1,BN-2 (or the grid filters) → the CSV (UTF-8 with BOM)
 *
 * The rest rides on existing routes:
 *   customer addresses, admin-created orders (and quotes)  + divisionId, districtId, areaId for a Bangladesh address (city and state
 *                                                           not needed, postcode optional: 4 digits); quotes send them for the zone
 *   GET orders?zone=CODE&cod=1&confirmation=STATUS         grid filters (also on export.csv); rows + deliveryZone, codDue, confirmationStatus
 *   GET orders/:number                                     + deliveryZone, etaDaysMin, etaDaysMax, codFee, advanceAmount, advancePaid, codDue,
 *                                                            codCollection: { amount } | null, confirmationStatus,
 *                                                            confirmation: { status, attempts, confirmedAt, log: [{ outcome, note, adminName, createdAt }] }
 *   PATCH orders/:number                                   + collectedAmount, collectionNote (short collection), confirmationOverride (reason)
 *   POST orders/:number/shipments                          + confirmationOverride (3–500 characters): ships an unconfirmed COD order
 *   shipping-rates                                         + zoneCode (null = any zone), etaDaysMin, etaDaysMax (0–60)
 *   GET/PATCH settings                                     + checkout.defaultCountry, cod: { maxOrderTotal, fee, advance, zones, requireConfirmation }
 */

const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const LIVE_ONLY = 'This needs the BuyNest backend; the demo data has no Bangladesh places, delivery zones, or cash on delivery.'
const live = (handler) => (ctx) => (realData() ? handler(ctx) : json({ message: LIVE_ONLY }, 404))
const fromLaravel = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))
const invalid = (errors) => json({ message: 'Please check the highlighted fields.', errors }, 422)

const isOrderNumber = (value) => typeof value === 'string' && /^BN-\d{1,12}$/.test(value)
const isId = (value) => Number.isInteger(value) && value > 0 && value < 1e9
const isIdText = (value) => /^\d{1,9}$/.test(value ?? '')
const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const isMoney = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100_000_000 && hasCents(value)
const isText = (value, { min = 0, max }) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max
export const MAX_SLIPS = 100

// ---- §2 Bangladesh addresses ----

/** "Bangladesh" or "BD" (any case). */
export const isBangladesh = (country) => typeof country === 'string' && /^(bd|bangladesh)$/i.test(country.trim())

/**
 * A Bangladesh address's place ids, checked into `values`, problems into
 * `errors` (as `${prefix}divisionId`…). True when the address is structured
 * (Bangladesh with the ids sent): city and state are then the server's, the
 * postcode optional (4 digits).
 */
export function bdAddressPlaces(body, values, errors, prefix = '') {
  if (!body || !isBangladesh(body.country)) return false
  const sent = ['divisionId', 'districtId', 'areaId'].filter((key) => body[key] !== undefined)
  if (sent.length === 0) return false
  for (const [key, message] of [
    ['divisionId', 'Choose the division.'],
    ['districtId', 'Choose the district.'],
    ['areaId', 'Choose the area (upazila or thana).'],
  ]) {
    if (isId(body[key])) values[key] = body[key]
    else errors[`${prefix}${key}`] = [message]
  }
  return true
}

/** The postcode of a structured Bangladesh address: '' / null → null, else 4 digits. */
export function bdPostcode(value, errors, field) {
  if (value === undefined) return undefined
  if (value === null || (typeof value === 'string' && value.trim() === '')) return null
  if (typeof value === 'string' && /^\d{4}$/.test(value.trim())) return value.trim()
  errors[field] = ['Enter the 4-digit postcode, or leave it empty.']
  return undefined
}

/** A Bangladeshi mobile as typed → +8801XXXXXXXXX, or null. */
export function bdMobile(value) {
  if (typeof value !== 'string') return null
  const match = /^(?:\+?88|0088)?(01[3-9]\d{8})$/.exec(value.trim().replace(/[\s.()-]/g, ''))
  return match ? `+88${match[1]}` : null
}
export const BD_MOBILE_MESSAGE = 'Enter a Bangladeshi mobile number, for example 01712 345678.'

// ---- §3 rates and §4 settings ----

/** Phase 14 fields of a table rate row (zoneCode, etaDaysMin, etaDaysMax), checked into values/errors. */
export function checkZoneRate(body, values, errors) {
  if (body.zoneCode !== undefined) {
    if (body.zoneCode === null || body.zoneCode === '') values.zoneCode = null
    else if (typeof body.zoneCode === 'string' && /^[a-z0-9_]{2,40}$/.test(body.zoneCode)) values.zoneCode = body.zoneCode
    else errors.zoneCode = ['Choose a delivery zone.']
  }
  for (const key of ['etaDaysMin', 'etaDaysMax']) {
    if (body[key] === undefined) continue
    if (body[key] === null || (Number.isInteger(body[key]) && body[key] >= 0 && body[key] <= 60)) values[key] = body[key]
    else errors[key] = ['Enter a whole number of days from 0 to 60, or leave it empty.']
  }
  if (Number.isInteger(values.etaDaysMin) && Number.isInteger(values.etaDaysMax) && values.etaDaysMax < values.etaDaysMin) errors.etaDaysMax = ['The longest time can’t be shorter than the shortest.']
}

export const COD_SETTING_RULES = {
  maxOrderTotal: (value) => (value === null || isMoney(value) ? null : 'Enter an amount of 0 or more with at most 2 decimals, or leave it empty for no limit.'),
  fee: (value) => (isMoney(value) ? null : 'Enter a fee of 0 or more, with at most 2 decimals.'),
  advance: (value) => (['none', 'delivery_charge'].includes(value) ? null : 'Choose what is paid in advance.'),
  zones: (value) => (Array.isArray(value) && value.length <= 50 && value.every((code) => typeof code === 'string' && /^[a-z0-9_]{2,40}$/.test(code)) ? null : 'Choose the zones from the list.'),
  requireConfirmation: (value) => (typeof value === 'boolean' ? null : 'Choose whether orders are confirmed by phone.'),
}
export const defaultCountryRule = (value) => (value === null || value === '' || isText(value, { min: 1, max: 60 }) ? null : 'Choose one of the countries the store ships to.')

// ---- §4 orders ----

/** ?zone&cod&confirmation of the order grid → the API's filters (only well-formed values). */
export function orderPhase14Filters(url) {
  const zone = url.searchParams.get('zone')
  const confirmation = url.searchParams.get('confirmation')
  return {
    ...(/^[a-z0-9_]{2,40}$/.test(zone ?? '') && { delivery_zone: zone }),
    ...(['1', 'true'].includes(url.searchParams.get('cod')) && { cod: '1' }),
    ...(['0', 'false'].includes(url.searchParams.get('cod')) && { cod: '0' }),
    ...(['pending', 'confirmed', 'unreachable', 'cancelled'].includes(confirmation) && { confirmation_status: confirmation }),
  }
}

/** The shipping override's reason (3–500 characters), into values/errors. */
export function checkConfirmationOverride(body, values, errors) {
  if (body.confirmationOverride === undefined || body.confirmationOverride === null) return
  if (isText(body.confirmationOverride, { min: 3, max: 500 })) values.confirmationOverride = body.confirmationOverride.trim()
  else errors.confirmationOverride = ['Give the reason for shipping without confirmation (3 to 500 characters).']
}

/** PATCH orders/:number: the cash collected on delivery and the note of a short collection, into values/errors. */
export function checkCollection(body, values, errors) {
  if (body.collectedAmount !== undefined && body.collectedAmount !== null) {
    if (isMoney(body.collectedAmount)) values.collectedAmount = body.collectedAmount
    else errors.collectedAmount = ['Enter the amount collected, with at most 2 decimals.']
  }
  if (body.collectionNote !== undefined && body.collectionNote !== null && body.collectionNote !== '') {
    if (isText(body.collectionNote, { min: 1, max: 500 })) values.collectionNote = body.collectionNote.trim()
    else errors.collectionNote = ['Keep the note to 500 characters.']
  }
  checkConfirmationOverride(body, values, errors)
}

const OUTCOMES = ['confirmed', 'unreachable', 'cancelled']
export function validateConfirmation(body) {
  const errors = {}
  if (!OUTCOMES.includes(body.outcome)) errors.outcome = ['Choose what came of the call.']
  if (body.note !== undefined && body.note !== null && !isText(body.note, { max: 500 })) errors.note = ['Keep the note to 500 characters.']
  if (body.outcome === 'cancelled' && !isText(body.reason, { min: 1, max: 200 })) errors.reason = ['Give the reason for cancelling.']
  if (Object.keys(errors).length > 0) return { errors }
  return {
    values: {
      outcome: body.outcome,
      ...(typeof body.note === 'string' && body.note.trim() && { note: body.note.trim() }),
      ...(body.outcome === 'cancelled' && { reason: body.reason.trim() }),
      ...(typeof body.notifyCustomer === 'boolean' && { notifyCustomer: body.notifyCustomer }),
    },
  }
}

const validNumbers = (numbers) => Array.isArray(numbers) && numbers.length >= 1 && numbers.length <= MAX_SLIPS && numbers.every(isOrderNumber) && new Set(numbers).size === numbers.length

// ---- files ----

const safeName = (disposition, extension, fallback) => {
  const name = /filename="?([A-Za-z0-9._-]{1,100})"?/.exec(disposition ?? '')?.[1]
  return name && !name.startsWith('.') && name.toLowerCase().endsWith(extension) ? name : fallback
}

/** The API's PDF, streamed through with a safe attachment name. */
function pdfAnswer(file, fallbackName) {
  if (!file.stream) return json(failed(file, fieldName).body, file.status)
  const length = file.contentLength
  return new Response(file.stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName(file.disposition, '.pdf', fallbackName)}"`,
      ...(length && /^\d+$/.test(length) && { 'Content-Length': length }),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** The courier CSV: UTF-8 with its byte order mark (reading the text drops it; Excel needs it for Bangla). */
function csvAnswer(file) {
  if (file.text === undefined) return json(failed(file, fieldName).body, file.status)
  return new Response(file.text.startsWith('\uFEFF') ? file.text : `\uFEFF${file.text}`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName(file.disposition, '.csv', 'courier.csv')}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

// ---- zones: shapes the browser sends ----

export function validateZone(body, { partial }) {
  const errors = {}
  const values = {}
  if (!partial) {
    if (typeof body.code === 'string' && /^[a-z0-9_]{2,40}$/.test(body.code.trim())) values.code = body.code.trim()
    else errors.code = ['Use 2 to 40 lower-case letters, digits, and underscores.']
  }
  if (!partial || body.name !== undefined) {
    if (isText(body.name, { min: 1, max: 60 })) values.name = body.name.trim()
    else errors.name = ['Enter a name of up to 60 characters.']
  }
  if (body.nameBn !== undefined) {
    if (body.nameBn === null || body.nameBn === '') values.nameBn = null
    else if (isText(body.nameBn, { max: 60 })) values.nameBn = body.nameBn.trim() || null
    else errors.nameBn = ['Keep the Bangla name to 60 characters.']
  }
  for (const key of ['isActive', 'isFallback']) {
    if (body[key] === undefined) continue
    if (typeof body[key] === 'boolean') values[key] = body[key]
    else errors[key] = ['Choose yes or no.']
  }
  if (body.places !== undefined) {
    const places = body.places
    const ok =
      Array.isArray(places) &&
      places.length <= 1000 &&
      places.every((entry) => entry && typeof entry === 'object' && ((isId(entry.districtId) && !entry.areaId) || (isId(entry.areaId) && !entry.districtId)))
    if (ok) values.places = places.map((entry) => (entry.areaId ? { areaId: entry.areaId } : { districtId: entry.districtId }))
    else errors.places = ['Add districts or areas from the lists.']
  } else if (!partial) values.places = []
  if (partial && Object.keys(values).length === 0 && Object.keys(errors).length === 0) errors.name = ['Change at least one field.']
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

// ---- the routes ----

const PHASE14_ROUTES = {
  'GET places/bd/:level': live(async (ctx) => {
    const level = ctx.id
    const parent = ctx.url.searchParams.get(level === 'districts' ? 'division' : 'district')
    if (level === 'areas' && !isIdText(parent)) return invalid({ district: ['Choose the district.'] })
    if (level === 'districts' && parent !== null && !isIdText(parent)) return invalid({ division: ['Choose the division.'] })
    return fromLaravel(await laravelPhase14Data.places(ctx.token, level, parent, ctx.request))
  }),

  'GET delivery-zones': live(async (ctx) => fromLaravel(await laravelPhase14Data.listZones(ctx.token, ctx.request))),
  'POST delivery-zones': live(async (ctx) => {
    const { values, errors } = validateZone(await readBody(ctx.request), { partial: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase14Data.createZone(ctx.token, values, ctx.request), 201)
  }),
  'PATCH delivery-zones/:id': live(async (ctx) => {
    const { values, errors } = validateZone(await readBody(ctx.request), { partial: true })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase14Data.updateZone(ctx.token, ctx.id, values, ctx.request))
  }),
  'DELETE delivery-zones/:id': live(async (ctx) => fromLaravel(await laravelPhase14Data.deleteZone(ctx.token, ctx.id, ctx.request), 200)),
  'POST delivery-zones/reorder': live(async (ctx) => {
    const { ids } = await readBody(ctx.request)
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every(isId) || new Set(ids).size !== ids.length) return invalid({ ids: ['Send every zone once, in the new order.'] })
    return fromLaravel(await laravelPhase14Data.reorderZones(ctx.token, ids, ctx.request))
  }),

  'GET orders/to-confirm': live(async (ctx) => {
    const limit = Math.min(Math.max(Number.parseInt(ctx.url.searchParams.get('limit') ?? '20', 10) || 20, 1), 100)
    const skip = Math.max(Number.parseInt(ctx.url.searchParams.get('skip') ?? '0', 10) || 0, 0)
    return fromLaravel(await laravelPhase14Data.toConfirm(ctx.token, { limit, skip }, ctx.request))
  }),
  'POST orders/:id/confirmation': live(async (ctx) => {
    const { values, errors } = validateConfirmation(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase14Data.recordConfirmation(ctx.token, ctx.id, values, adminOrderDetail, ctx.request), 200)
  }),

  'GET orders/:id/packing-slip.pdf': live(async (ctx) => pdfAnswer(await laravelPhase14Data.packingSlipPdf(ctx.token, ctx.id, ctx.request), `packing-slip-${ctx.id}.pdf`)),
  'POST orders/packing-slips': live(async (ctx) => {
    const { numbers } = await readBody(ctx.request)
    if (!validNumbers(numbers)) return invalid({ numbers: [`Choose 1 to ${MAX_SLIPS} orders.`] })
    return pdfAnswer(await laravelPhase14Data.packingSlipsPdf(ctx.token, numbers, ctx.request), 'packing-slips.pdf')
  }),
  'GET orders/export/courier.csv': live(async (ctx) => {
    const query = new URLSearchParams()
    const numbers = ctx.url.searchParams.get('numbers')
    if (numbers !== null) {
      const list = numbers.split(',').map((number) => number.trim().toUpperCase()).filter(Boolean)
      if (!validNumbers(list)) return invalid({ numbers: [`Choose 1 to ${MAX_SLIPS} orders.`] })
      query.set('numbers', list.join(','))
    } else {
      // By the grid's filters.
      const { searchParams } = ctx.url
      const q = searchParams.get('q')?.trim().slice(0, 100)
      if (q) query.set('search', q)
      if (['pending_payment', 'processing', 'shipped', 'delivered', 'cancelled', 'closed'].includes(searchParams.get('status'))) query.set('status', searchParams.get('status'))
      for (const [key, value] of Object.entries(orderPhase14Filters(ctx.url))) query.set(key, value)
    }
    return csvAnswer(await laravelPhase14Data.courierCsv(ctx.token, query, ctx.request))
  }),
}

const PLACE_LEVELS = ['divisions', 'districts', 'areas']

/**
 * The phase 14 routes in adminApi.js's matcher: { route, id } for one of
 * them, null for a malformed address of theirs (404), undefined when not theirs.
 */
export function matchPhase14Route(method, segments) {
  const [first, second, third, ...rest] = segments
  if (first === 'places') {
    if (second !== 'bd' || !PLACE_LEVELS.includes(third) || rest.length > 0) return null
    return { route: PHASE14_ROUTES[`${method} places/bd/:level`], id: third }
  }
  if (first === 'delivery-zones') {
    if (third !== undefined) return null
    if (second === undefined) return { route: PHASE14_ROUTES[`${method} delivery-zones`] }
    if (second === 'reorder') return { route: PHASE14_ROUTES[`${method} delivery-zones/reorder`] }
    return isIdText(second) ? { route: PHASE14_ROUTES[`${method} delivery-zones/:id`], id: second } : null
  }
  if (first !== 'orders') return undefined
  if (second === 'to-confirm' && third === undefined) return { route: PHASE14_ROUTES[`${method} orders/to-confirm`] }
  if (second === 'packing-slips' && third === undefined) return { route: PHASE14_ROUTES[`${method} orders/packing-slips`] }
  if (second === 'export' && third === 'courier.csv' && rest.length === 0) return { route: PHASE14_ROUTES[`${method} orders/export/courier.csv`] }
  if (isOrderNumber(second) && rest.length === 0 && ['confirmation', 'packing-slip.pdf'].includes(third)) return { route: PHASE14_ROUTES[`${method} orders/:id/${third}`], id: second }
  return undefined
}
