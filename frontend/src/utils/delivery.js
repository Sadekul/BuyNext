import { translate } from '../i18n'

/*
 * Phase 18 (docs/backend/PHASE18_CONTRACT.md §3): a courier shipment's
 * delivery status, as the API normalises it ("shipped" = a manual shipment).
 */

/** The tracker's steps, in order. */
export const DELIVERY_STEPS = ['booked', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered']
/** Not steps: shown as a notice. Returned and cancelled also stop the steps (the parcel is no longer on its way). */
export const DELIVERY_NOTICES = ['on_hold', 'partly_delivered', 'returned', 'cancelled']
export const DELIVERY_STOPPED = ['returned', 'cancelled']
const KNOWN = [...DELIVERY_STEPS, ...DELIVERY_NOTICES]

/** True for a shipment a courier reports on (booked through its API), not a manual one. */
export const isCourierShipment = (shipment) => KNOWN.includes(shipment?.deliveryStatus)

/** An order's newest courier shipment (for "Delivery: On the way" in the order list), or null. */
export function latestCourierShipment(order) {
  const shipments = (order?.shipments ?? []).filter(isCourierShipment)
  return shipments.length > 0 ? shipments[shipments.length - 1] : null
}

/**
 * Where on the steps the parcel is: its own step, else (on hold, partly
 * delivered) the furthest step before Delivered an update reached.
 */
export function deliveryStepIndex(shipment) {
  const own = DELIVERY_STEPS.indexOf(shipment?.deliveryStatus)
  if (own >= 0) return own
  const reached = (shipment?.events ?? []).map((event) => DELIVERY_STEPS.indexOf(event.deliveryStatus)).filter((index) => index >= 0 && index < DELIVERY_STEPS.length - 1)
  if (reached.length > 0) return Math.max(...reached)
  return shipment?.deliveryStatus === 'partly_delivered' ? DELIVERY_STEPS.indexOf('out_for_delivery') : 0
}

/** A delivery status in the shopper's language (the API's own label for anything this app doesn't know). */
export const deliveryStatusLabel = (status, fallback) => translate(`orders:delivery.statuses.${status}`, { defaultValue: fallback || status || '' })
