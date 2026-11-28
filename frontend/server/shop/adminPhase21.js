import { laravel } from '../http.js'
import { failed, rangeOf } from './adminSystem.js'
import { camelPath } from './laravel.js'

/*
 * Phase 21 admin data from BuyNest's Laravel API (docs/backend/PHASE21_CONTRACT.md
 * §1): sales and cash reports. Money in (payments received per channel and
 * day), cash on delivery (per courier: shipped, collected, fees, paid to the
 * shop, still owed), the COD orders still to collect, and the courier
 * payments staff record. Only listed fields go either way; snake_case
 * becomes camelCase; money strings ("9800.00") become numbers, and money the
 * API doesn't know (a courier's fees that were never reported) stays null,
 * never 0.
 * Every call resolves to { ok: true, status, data } or { ok: false, status, body }.
 */

/** The couriers a payment can come from (Shipment::CARRIERS' Bangladesh couriers). */
export const PAYOUT_CARRIERS = ['steadfast', 'pathao', 'redx', 'paperfly', 'sundarban']
/** Shipment::DELIVERY_STATUSES (the outstanding list's latest courier status). */
const DELIVERY_STATUSES = ['booked', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'partly_delivered', 'on_hold', 'returned', 'cancelled', 'shipped']

const str = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)
const short = (value, max) => str(value)?.slice(0, max) ?? null
const int = (value) => (Number.isInteger(value) ? value : typeof value === 'string' && /^-?\d{1,12}$/.test(value) ? Number(value) : null)
const count = (value) => int(value) ?? 0
/** "1234.50" or 1234.5 → 1234.5; anything else (missing, not a number) → null. */
const moneyOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
const money = (value) => moneyOrNull(value) ?? 0
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null)
const arrayOf = (value) => (Array.isArray(value) ? value : [])
const listOf = (data) => arrayOf(data?.data)
const currencyCode = (value) => (typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null)
const dayText = (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null)
const carrierCode = (value) => (typeof value === 'string' && /^[a-z][a-z0-9_]{0,19}$/.test(value) ? value : null)
// A payment channel: "stripe", "sslcommerz:bkash", "cash:steadfast", "cash:staff", "advance"…
const channelCode = (value) => (typeof value === 'string' && /^[a-z][a-z0-9_]{0,30}(:[a-z0-9_]{1,30})?$/.test(value) ? value : null)
const withRange = (data) => (objectOf(data?.meta) ? { range: rangeOf(data.meta) } : {})

// ---- 422 field names: the API's → the admin's ----

const FIELD_NAMES = { received_on: 'receivedOn', confirm_duplicate: 'confirmDuplicate', older_than_days: 'olderThanDays' }
export const fieldName = (field) => FIELD_NAMES[field] ?? camelPath(field)

// ---- courier payments ----

/** A CourierPayout as the admin sees it. `fees` is null when none was typed in. */
export function courierPayout(raw = {}) {
  return {
    id: int(raw.id),
    carrier: carrierCode(raw.carrier),
    carrierLabel: short(raw.carrier_label, 60) ?? str(raw.carrier) ?? '',
    amount: money(raw.amount),
    fees: moneyOrNull(raw.fees),
    currency: currencyCode(raw.currency),
    receivedOn: dayText(raw.received_on),
    reference: short(raw.reference, 100),
    note: short(raw.note, 500),
    adminName: short(raw.admin_name, 120),
    createdAt: str(raw.created_at),
  }
}

/** The 409 "same courier, amount and date" answer's existing payment: the whole payment, or only its id. */
export function duplicatePayout(raw) {
  if (Number.isInteger(raw)) return { id: raw }
  const payout = objectOf(raw) ? courierPayout(raw) : null
  return payout?.id !== null && payout?.id !== undefined ? payout : null
}

/** The admin's checked values → the API's body (money as 2-decimal strings). */
export function toPayoutBody(values) {
  const body = {}
  if (values.carrier !== undefined) body.carrier = values.carrier
  if (values.amount !== undefined) body.amount = values.amount.toFixed(2)
  if (values.fees !== undefined) body.fees = values.fees === null ? null : values.fees.toFixed(2)
  if (values.receivedOn !== undefined) body.received_on = values.receivedOn
  if (values.reference !== undefined) body.reference = values.reference
  if (values.note !== undefined) body.note = values.note
  if (values.confirmDuplicate === true) body.confirm_duplicate = true
  return body
}

// ---- reports ----

/** Phase 21 additions to GET reports/sales (REPORT_MAPS.sales): store currency only, adding up to the totals. */
export function salesBreakdowns(data) {
  const row = (raw) => ({ orders: count(raw?.orders), gross: money(raw?.gross), refunds: money(raw?.refunds), net: money(raw?.net) })
  return {
    ...(Array.isArray(data?.by_payment_method) && {
      byPaymentMethod: data.by_payment_method
        .filter((raw) => channelCode(raw?.method))
        .map((raw) => ({ method: raw.method, label: short(raw.label, 80) ?? raw.method, ...row(raw) })),
    }),
    ...(Array.isArray(data?.by_delivery_zone) && {
      // zoneCode null: no zone (outside Bangladesh, or a free-text address).
      byDeliveryZone: data.by_delivery_zone.map((raw) => ({ zoneCode: short(raw?.zone_code, 40), name: short(raw?.name, 120) ?? '', ...row(raw) })),
    }),
  }
}

/** GET reports/payments: money received by the day it arrived. */
export function paymentsReport(raw) {
  const data = objectOf(raw) ?? {}
  const totals = objectOf(data.totals) ?? {}
  return {
    currency: currencyCode(data.currency),
    totals: {
      received: money(totals.received),
      online: money(totals.online),
      codCash: money(totals.cod_cash),
      other: money(totals.other),
      refunds: money(totals.refunds),
      netReceived: money(totals.net_received),
    },
    channels: arrayOf(data.channels)
      .filter((row) => channelCode(row?.channel))
      .map((row) => ({ channel: row.channel, label: short(row.label, 80) ?? row.channel, amount: money(row.amount), count: count(row.count) })),
    series: arrayOf(data.series)
      .filter((point) => typeof point?.period === 'string')
      .map((point) => ({
        period: point.period.slice(0, 10),
        online: money(point.online),
        codCash: money(point.cod_cash),
        other: money(point.other),
        refunds: money(point.refunds),
        netReceived: money(point.net_received),
      })),
    otherCurrencies: arrayOf(data.other_currencies)
      .filter((row) => currencyCode(row?.currency))
      .map((row) => ({ currency: row.currency, received: money(row.received), count: count(row.count), refunds: money(row.refunds), netReceived: money(row.net_received) })),
  }
}

// A negative balance's reason: payments recorded beyond the cash, or (none recorded) fees beyond the cash.
const BALANCE_NOTES = ['paid_more_than_recorded', 'fees_more_than_collected']
/** One courier's all-time balance. A negative `owed` stays negative, with its note (BALANCE_NOTES). */
export function courierBalance(raw = {}) {
  return {
    carrier: carrierCode(raw.carrier),
    label: short(raw.label, 60) ?? str(raw.carrier) ?? '',
    collectedAllTime: money(raw.collected_all_time),
    // null: the courier never reported its fees (and none were typed into a payment).
    feesAllTime: moneyOrNull(raw.fees_all_time),
    feesReported: raw.fees_reported === true,
    payoutsAllTime: money(raw.payouts_all_time),
    owed: money(raw.owed),
    note: BALANCE_NOTES.includes(raw.note) ? raw.note : null,
    lastPayoutOn: dayText(raw.last_payout_on),
  }
}

/** GET reports/cod: per courier for the period, the all-time balances, the shop's whole exposure, staff collections. */
export function codReport(raw) {
  const data = objectOf(raw) ?? {}
  const outstanding = objectOf(data.outstanding) ?? {}
  return {
    currency: currencyCode(data.currency),
    period: arrayOf(data.period)
      .filter((row) => carrierCode(row?.carrier))
      .map((row) => ({
        carrier: row.carrier,
        label: short(row.label, 60) ?? row.carrier,
        shipped: count(row.shipped),
        delivered: count(row.delivered),
        returned: count(row.returned),
        cancelled: count(row.cancelled),
        collected: money(row.collected),
        fees: moneyOrNull(row.fees),
        payouts: money(row.payouts),
      })),
    balances: arrayOf(data.balances).map(courierBalance).filter((row) => row.carrier),
    outstanding: { orders: count(outstanding.orders), amount: money(outstanding.amount) },
    staff: { collected: money(objectOf(data.staff)?.collected) },
  }
}

/** One COD order still to collect. */
export function outstandingOrder(raw = {}) {
  return {
    number: short(raw.number, 40),
    placedAt: str(raw.placed_at),
    shippedAt: str(raw.shipped_at),
    carrier: carrierCode(raw.carrier),
    consignmentId: short(raw.consignment_id, 100),
    deliveryStatus: DELIVERY_STATUSES.includes(raw.delivery_status) ? raw.delivery_status : null,
    codDue: money(raw.cod_due),
    daysSinceShipped: int(raw.days_since_shipped),
  }
}

/** ?page&per_page from the admin's limit/skip, plus any filters that have a value. */
function listParams({ limit = 20, skip = 0, ...filters }) {
  const params = new URLSearchParams({ page: String(Math.floor(skip / limit) + 1), per_page: String(limit) })
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  return params
}

// ---- the calls ----

const fail = (result) => failed(result, fieldName, duplicatePayout)
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : fail(result))
const call = (path, token, request, options = {}) => laravel(`/api/admin/v1${path}`, { token, request, ...options })

export const laravelPhase21Data = {
  /** params: URLSearchParams of from, to, group_by. */
  async payments(token, params, request) {
    return answer(await call(`/reports/payments?${params}`, token, request), [200], (data) => ({ ...paymentsReport(data?.data), ...withRange(data), live: true }))
  },
  async cod(token, params, request) {
    return answer(await call(`/reports/cod?${params}`, token, request), [200], (data) => ({ ...codReport(data?.data), ...withRange(data), live: true }))
  },
  /** filters: { carrier, olderThanDays, limit, skip } → { orders, total, limit, skip }. */
  async outstanding(token, { carrier, olderThanDays, limit, skip }, request) {
    const result = await call(`/reports/cod/outstanding?${listParams({ carrier, older_than_days: olderThanDays, limit, skip })}`, token, request)
    return answer(result, [200], (data) => ({
      orders: listOf(data).map(outstandingOrder).filter((order) => order.number),
      total: int(data?.meta?.total) ?? listOf(data).length,
      currency: currencyCode(data?.meta?.currency),
      limit,
      skip,
      live: true,
    }))
  },

  /** filters: { carrier, from, to, limit, skip } → { payouts, total, limit, skip }. */
  async payouts(token, { limit, skip, ...filters }, request) {
    const result = await call(`/courier-payouts?${listParams({ ...filters, limit, skip })}`, token, request)
    return answer(result, [200], (data) => ({
      payouts: listOf(data).map(courierPayout).filter((payout) => payout.id !== null),
      total: int(data?.meta?.total) ?? listOf(data).length,
      limit,
      skip,
      live: true,
    }))
  },
  /** 409 { message, duplicateOf } when the same courier, amount and date exist (unless confirmDuplicate). */
  async createPayout(token, values, request) {
    const result = await call('/courier-payouts', token, request, { method: 'POST', body: toPayoutBody(values) })
    return answer(result, [200, 201], (data) => ({ payout: courierPayout(data?.data ?? {}), live: true }))
  },
  async updatePayout(token, id, values, request) {
    const result = await call(`/courier-payouts/${id}`, token, request, { method: 'PATCH', body: toPayoutBody(values) })
    return answer(result, [200], (data) => ({ payout: courierPayout(data?.data ?? {}), live: true }))
  },
  async deletePayout(token, id, request) {
    return answer(await call(`/courier-payouts/${id}`, token, request, { method: 'DELETE' }), [200, 204], () => ({ id: Number(id), deleted: true, live: true }))
  },
}
