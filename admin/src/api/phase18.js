import { api } from './client'

/*
 * Phase 18 (docs/backend/PHASE18_CONTRACT.md), BuyNest's backend only:
 * couriers (Steadfast and Pathao) and their settings, Pathao's cities,
 * zones and areas, booking a courier from an order (one or many), and
 * asking the courier for a parcel's status (server/adminPhase18Api.js in the
 * frontend project). Permissions: orders.view to list couriers,
 * settings.edit for their settings, shipments.create to book and refresh.
 * No courier key or secret ever reaches the admin app.
 */

export const phase18Keys = {
  couriers: ['couriers'],
  balance: ['couriers', 'balance'],
  booking: (number) => ['courier-booking', number],
  pathao: (level, parent) => ['pathao-places', level, String(parent ?? '')],
}

/**
 * → { couriers: [{ key, label, configured, mode: sandbox | live | null, balance: "৳ …" | null, webhookUrl }],
 *     settings: { defaultCourier, autoSync, noteTemplate, pathaoItemType, pathaoDeliveryType } }.
 * `balance: true` asks Steadfast for its balance (the API keeps it 5 minutes).
 */
export const getCouriers = ({ balance = false, signal } = {}) => api.get('/api/admin/couriers', { params: balance ? { balance: 1 } : undefined, signal })
/** Any of { defaultCourier, autoSync, noteTemplate, pathaoItemType, pathaoDeliveryType } → { settings }. */
export const updateCourierSettings = (values) => api.put('/api/admin/couriers/settings', values)

/** level: cities | zones (of a city) | areas (of a zone) → { options: [{ id, name }] }. */
export function getPathaoPlaces(level, parent, { signal } = {}) {
  const path = level === 'cities' ? 'cities' : level === 'zones' ? `cities/${encodeURIComponent(parent)}/zones` : `zones/${encodeURIComponent(parent)}/areas`
  return api.get(`/api/admin/couriers/pathao/${path}`, { signal })
}

/**
 * → { booking: { defaultCourier, couriers: [{ key, label, mode }], codAmount, weightKg, note, phone, addressLine,
 *     pathaoMatch: { cityId, zoneId, areaId }, problem (why it can't be booked now) | null, awaitsConfirmation } }.
 */
export const getBookingDefaults = (number, { signal } = {}) => api.get(`/api/admin/orders/${encodeURIComponent(number)}/courier-booking`, { signal })

// The courier gets 20 s per call: the admin waits a little longer than usual.
const BOOKING_TIMEOUT = 60_000
// Up to 50 orders, one courier call each.
const BULK_TIMEOUT = 300_000

/**
 * { courier, codAmount?, weightKg?, note?, notifyCustomer?, confirmationOverride?,
 *   pathao?: { cityId, zoneId, areaId?, deliveryType?, itemType? } } → 201 { shipment }.
 */
export const bookCourier = (number, values) => api.post(`/api/admin/orders/${encodeURIComponent(number)}/courier-booking`, values, { timeout: BOOKING_TIMEOUT })
/** Steadfast only: { booked: [{ number, consignmentId, trackingCode }], failed: [{ number, message }] }. */
export const bookCourierMany = (numbers, courier = 'steadfast') => api.post('/api/admin/orders/courier-bookings', { courier, numbers }, { timeout: BULK_TIMEOUT })
/** Asks the courier now → { shipment }. */
export const syncShipment = (number) => api.post(`/api/admin/shipments/${encodeURIComponent(number)}/sync`, {}, { timeout: BOOKING_TIMEOUT })
