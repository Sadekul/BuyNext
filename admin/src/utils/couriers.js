import { LuBan, LuCirclePause, LuClipboardCheck, LuMapPin, LuPackage, LuPackageCheck, LuPackageMinus, LuTruck, LuUndo2, LuWarehouse } from 'react-icons/lu'

/*
 * Phase 18 (docs/backend/PHASE18_CONTRACT.md): couriers, the normalised
 * delivery status of a parcel (icon + words for StatusBadge: colour only
 * adds to them), and the rules of the booking dialog. The API is the judge;
 * these only catch what can be seen before sending.
 */

export const COURIERS = {
  steadfast: { label: 'Steadfast', bulk: true },
  pathao: { label: 'Pathao', bulk: false },
}
export const courierLabel = (key, fallback) => COURIERS[key]?.label ?? fallback ?? key ?? 'the courier'

/** Shipment::DELIVERY_STATUSES, in the order a parcel moves through them (the API sends a translated label too). */
export const DELIVERY_STATUSES = {
  booked: { label: 'Booked', tone: 'info', icon: LuClipboardCheck },
  picked_up: { label: 'Picked up', tone: 'info', icon: LuWarehouse },
  in_transit: { label: 'In transit', tone: 'info', icon: LuTruck },
  out_for_delivery: { label: 'Out for delivery', tone: 'info', icon: LuMapPin },
  delivered: { label: 'Delivered', tone: 'success', icon: LuPackageCheck },
  partly_delivered: { label: 'Partly delivered', tone: 'warning', icon: LuPackageMinus },
  on_hold: { label: 'On hold', tone: 'warning', icon: LuCirclePause },
  returned: { label: 'Returned', tone: 'danger', icon: LuUndo2 },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: LuBan },
  shipped: { label: 'Shipped (no courier updates)', tone: 'neutral', icon: LuPackage },
}

/** For StatusBadge: the status's icon and tone, with the API's label when it sent one. */
export function deliveryStatus(status, label) {
  const known = DELIVERY_STATUSES[status] ?? { label: status ?? 'Unknown', tone: 'neutral', icon: LuPackage }
  return { ...known, label: label || known.label }
}

/** What staff should do when a parcel didn't simply arrive (the order page's callout). */
export const NEXT_STEPS = {
  returned: 'The parcel is coming back to you. When it arrives, check the items, then refund or cancel the order (or create a return) and put the items back in stock.',
  cancelled: 'The courier cancelled this booking. Book it again (or ship it another way), or cancel the order if the customer no longer wants it.',
  partly_delivered: 'The customer kept only part of the parcel. Check what came back and record the cash the courier collected (Mark as delivered, with the amount).',
  on_hold: 'The courier is holding the parcel. Call the customer to agree a new delivery time, then ask the courier to try again.',
}
export const needsAttention = (status) => Object.hasOwn(NEXT_STEPS, status)

/** The environment variable names each courier reads in backend/.env: names only, never values. */
export const COURIER_ENV = {
  steadfast: ['STEADFAST_API_KEY', 'STEADFAST_SECRET_KEY', 'STEADFAST_WEBHOOK_TOKEN', 'STEADFAST_API_URL (optional)'],
  pathao: ['PATHAO_CLIENT_ID', 'PATHAO_CLIENT_SECRET', 'PATHAO_USERNAME', 'PATHAO_PASSWORD', 'PATHAO_STORE_ID', 'PATHAO_MODE (sandbox or live)', 'PATHAO_WEBHOOK_SECRET', 'PATHAO_API_URL (optional)'],
}

export const PATHAO_ITEM_TYPES = { parcel: 'Parcel', document: 'Document' }
export const PATHAO_DELIVERY_TYPES = { normal: 'Normal delivery', on_demand: 'On-demand delivery' }

const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const toNumber = (text) => (String(text ?? '').trim() === '' ? NaN : Number(text))

/**
 * The booking form's problems, by field: courier, codAmount (0 … the order
 * total), weightKg (more than 0, at most 50; Pathao takes 0.5–10 and the API
 * clamps), note (≤ 200), the Pathao city and zone, and the unconfirmed-COD
 * override (ticked, with a reason of 3 or more characters).
 */
export function bookingErrors(form, { maxCod, unconfirmed }) {
  const errors = {}
  if (!COURIERS[form.courier]) errors.courier = ['Choose a courier.']
  const cod = toNumber(form.codAmount)
  if (!Number.isFinite(cod) || cod < 0 || !hasCents(cod)) errors.codAmount = ['Enter the cash to collect: 0 or more, with at most 2 decimals.']
  else if (Number.isFinite(maxCod) && Math.round(cod * 100) > Math.round(maxCod * 100)) errors.codAmount = ['That is more than the order total.']
  if (String(form.weightKg ?? '').trim() !== '') {
    const weight = toNumber(form.weightKg)
    if (!Number.isFinite(weight) || weight <= 0 || weight > 50) errors.weightKg = ['Enter the weight in kg, more than 0 and at most 50.']
  }
  if ((form.note ?? '').trim().length > 200) errors.note = ['Keep the note to 200 characters.']
  if (form.courier === 'pathao') {
    if (!form.pathaoCityId) errors.pathaoCityId = ['Choose the city.']
    if (!form.pathaoZoneId) errors.pathaoZoneId = ['Choose the zone.']
  }
  if (unconfirmed && !form.override) errors.overrideConfirmation = ['Confirm the order by phone first, or tick “Book without confirmation” and give the reason.']
  if (unconfirmed && form.override && (form.overrideReason ?? '').trim().length < 3) errors.confirmationOverride = ['Give the reason for booking without confirmation (at least 3 characters).']
  return errors
}

/** The checked form → what the admin service takes. */
export function toBookingValues(form, { unconfirmed }) {
  const weight = String(form.weightKg ?? '').trim()
  return {
    courier: form.courier,
    codAmount: Number(form.codAmount),
    ...(weight && { weightKg: Number(weight) }),
    note: (form.note ?? '').trim() || null,
    notifyCustomer: form.notify !== false,
    ...(unconfirmed && form.override && { confirmationOverride: form.overrideReason.trim() }),
    ...(form.courier === 'pathao' && {
      pathao: {
        cityId: Number(form.pathaoCityId),
        zoneId: Number(form.pathaoZoneId),
        ...(form.pathaoAreaId && { areaId: Number(form.pathaoAreaId) }),
        ...(form.pathaoDeliveryType && { deliveryType: form.pathaoDeliveryType }),
        ...(form.pathaoItemType && { itemType: form.pathaoItemType }),
      },
    }),
  }
}
