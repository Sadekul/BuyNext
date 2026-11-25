import { apiClient } from './apiClient'

/*
 * Phase 17 "Deliver to": what delivery to a Bangladesh area costs and how long
 * it takes, before anything is in the cart. Through the catalog service on this
 * site's own address (/api/catalog/delivery/estimate → /api/v1/delivery/estimate,
 * frontend/server/catalogApi.js). The API computes it with the checkout's own
 * rules (zone rates, cash on delivery), so the numbers match the cart.
 */

const CATALOG = { sameOrigin: true }

const money = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value))
const days = (value) => (Number.isInteger(value) && value >= 0 ? value : null)
const text = (value) => (typeof value === 'string' ? value : '')

function normalizeMethod(raw = {}) {
  return {
    id: text(raw.id),
    label: text(raw.label),
    price: money(raw.price) ?? 0,
    eta: text(raw.eta),
    etaDaysMin: days(raw.eta_days_min),
    etaDaysMax: days(raw.eta_days_max),
    freeOverThreshold: raw.free_over_threshold === true,
  }
}

/**
 * `{ data: { area, zone, methods, free_shipping_threshold, cod } }` →
 * `{ area: { id, name, district, division }, zone: { code, name } | null, methods: [...],
 *    freeShippingThreshold, cod: { available, reason, message, fee } }`.
 */
export function normalizeEstimate(raw) {
  const data = raw?.data ?? {}
  const area = data.area ?? {}
  const zone = data.zone && typeof data.zone === 'object' && data.zone.code ? { code: text(data.zone.code), name: text(data.zone.name) } : null
  const cod = data.cod ?? {}
  return {
    area: { id: Number(area.id) || null, name: text(area.name), district: text(area.district), division: text(area.division) },
    zone,
    methods: (Array.isArray(data.methods) ? data.methods : []).map(normalizeMethod).filter((method) => method.id),
    freeShippingThreshold: money(data.free_shipping_threshold),
    cod: {
      available: cod.available === true,
      reason: typeof cod.reason === 'string' ? cod.reason : null,
      message: typeof cod.message === 'string' ? cod.message : null,
      fee: money(cod.fee) ?? 0,
    },
  }
}

/** GET /api/catalog/delivery/estimate?area_id= → the normalized estimate. ApiError 422 for an unknown area. */
export async function getDeliveryEstimate(areaId, { signal } = {}) {
  return normalizeEstimate(await apiClient.get('/api/catalog/delivery/estimate', { ...CATALOG, params: { area_id: areaId }, signal }))
}
