import { ApiError, api } from './client'

/*
 * Phase 14 (docs/backend/PHASE14_CONTRACT.md), BuyNest's backend only:
 * Bangladesh places, delivery zones, the phone confirmation of cash on
 * delivery orders, packing slip PDFs, and the courier CSV
 * (server/adminPhase14Api.js in the frontend project). Bangladesh
 * addresses, zone rates, COD settings, the order's zone and COD amounts,
 * the collection on delivery, and the shipping override ride on the
 * existing routes. Permissions: settings.edit for zones (read with
 * settings.view), orders.edit for confirmations, orders.view for slips and
 * the CSV; places need only an admin session.
 */

export const phase14Keys = {
  divisions: ['bd-places', 'divisions'],
  districts: (divisionId) => ['bd-places', 'districts', String(divisionId)],
  areas: (districtId) => ['bd-places', 'areas', String(districtId)],
  zones: ['delivery-zones'],
  toConfirm: (params) => ['to-confirm', params],
}

// ---- §1 places (English names; nameBn too) ----

/** → { places: [{ id, name, nameBn }] } (8 divisions). */
export const getDivisions = ({ signal } = {}) => api.get('/api/admin/places/bd/divisions', { signal })
/** → { places: [{ id, name, nameBn, divisionId }] }. */
export const getDistricts = (divisionId, { signal } = {}) => api.get('/api/admin/places/bd/districts', { params: { division: divisionId }, signal })
/** → { places: [{ id, name, nameBn, kind: upazila | thana, postcodes: ['1212'] }] }. */
export const getAreas = (districtId, { signal } = {}) => api.get('/api/admin/places/bd/areas', { params: { district: districtId }, signal })

// ---- §3 delivery zones (read settings.view, change settings.edit) ----

/**
 * → { zones: [Zone] }, in order. Zone = { id, code, name, nameBn, position, isActive, isFallback,
 *     rateCount, places: [{ districtId, areaId, name, districtName }] } (one of the ids per place; each place in one zone).
 */
export const getDeliveryZones = ({ signal } = {}) => api.get('/api/admin/delivery-zones', { signal })
/** { code, name, nameBn, isActive, isFallback?, places: [{ districtId } | { areaId }] } → 201 { zone }. */
export const createDeliveryZone = (values) => api.post('/api/admin/delivery-zones', values)
/** The same fields, all optional (places replaces the whole list) → { zone }. */
export const updateDeliveryZone = (id, values) => api.patch(`/api/admin/delivery-zones/${id}`, values)
export const deleteDeliveryZone = (id) => api.delete(`/api/admin/delivery-zones/${id}`)
/** Every zone id once, in the new order → { zones }. */
export const reorderDeliveryZones = (ids) => api.post('/api/admin/delivery-zones/reorder', { ids })

// ---- §4 phone confirmation (orders.edit) ----

/**
 * Sales → To confirm: COD orders waiting for a call (to call, or not reached), oldest first.
 * { limit, skip } → { orders: [{ number, placedAt, total, codDue, currency, customerName, phone, address (one line),
 *   deliveryZone, confirmationStatus, attempts, lastNote, lastAttemptAt, history: { orders, delivered, cancelled, returns } }], total }
 */
export const getToConfirm = (params, { signal } = {}) => api.get('/api/admin/orders/to-confirm', { params, signal })
/**
 * One call's outcome: { outcome: confirmed | unreachable | cancelled, note?, reason? (cancelled),
 * notifyCustomer? } → { order } (the order with its confirmation).
 */
export const recordConfirmation = (number, values) => api.post(`/api/admin/orders/${encodeURIComponent(number)}/confirmation`, values)

// ---- §5 packing slips and the courier CSV (orders.view) ----

/** One order's packing slip as a PDF. */
export const packingSlipPdfUrl = (number) => `/api/admin/orders/${encodeURIComponent(number)}/packing-slip.pdf`
export const courierCsvPath = (numbers) => `/api/admin/orders/export/courier.csv?${new URLSearchParams({ numbers: numbers.join(',') })}`

/**
 * Downloads a file from the admin service and saves it in the browser
 * (a POST can't be a plain link). A refusal (JSON) becomes an ApiError with
 * the server's message, so it can be shown instead of saving an error page.
 */
export async function saveFile(path, { method = 'GET', body, fallbackName }) {
  let response
  try {
    response = await fetch(new URL(path, window.location.origin), {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/pdf, text/csv, application/json', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    throw new ApiError('Network error. Check your connection and try again.')
  }
  const type = response.headers.get('content-type') ?? ''
  if (!response.ok || type.includes('application/json')) {
    const data = await response.json().catch(() => null)
    throw new ApiError(data?.message ?? (response.status === 403 ? 'This account does not have admin access.' : 'The file could not be made. Please try again.'), { status: response.ok ? 502 : response.status, data })
  }
  const name = /filename="?([A-Za-z0-9._-]{1,100})"?/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName
  const blob = await response.blob()
  // jsdom (the tests) has no object URLs: the file is fetched and checked, just not saved.
  if (typeof URL.createObjectURL !== 'function') return { name, size: blob.size }
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { name, size: blob.size }
}

/** Up to 100 orders' packing slips in one PDF. */
export const downloadPackingSlips = (numbers) => saveFile('/api/admin/orders/packing-slips', { method: 'POST', body: { numbers }, fallbackName: 'packing-slips.pdf' })
/** The courier CSV of these orders (UTF-8 with BOM, opens in Excel with Bangla). */
export const downloadCourierCsv = (numbers) => saveFile(courierCsvPath(numbers), { fallbackName: 'courier.csv' })
