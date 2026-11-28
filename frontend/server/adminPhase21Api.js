import { json, laravelFile, readBody } from './http.js'
import { failed } from './shop/adminSystem.js'
import { PAYOUT_CARRIERS, laravelPhase21Data } from './shop/adminPhase21.js'

/*
 * Phase 21 admin routes and rules (docs/backend/PHASE21_CONTRACT.md §1 and
 * §2): sales and cash reports. BuyNest's Laravel API only. Matched by
 * adminApi.js before its own routes, so the admin session check there runs
 * first; the API checks the role's permission (reports.view to read,
 * cash.manage to record, change or delete a courier payment) and answers 403
 * { code: "permission_denied", permission }, passed on unchanged.
 *
 * Every report's range: { from, to, groupBy?, timezone } (the store time zone its dates are in).
 *
 *   GET    /api/admin/reports/payments?from&to&groupBy
 *            → { currency, totals: { received, online, codCash, other, refunds, netReceived },
 *                channels: [{ channel ("stripe", "sslcommerz:bkash", "advance", "cash:steadfast", "cash:staff", "gift_card"…), label, amount, count }],
 *                series: [{ period, online, codCash, other, refunds, netReceived }],
 *                otherCurrencies: [{ currency, received, count, refunds, netReceived }], range }
 *   GET    /api/admin/reports/payments.csv?from&to&groupBy               (the API's file, with a BOM)
 *   GET    /api/admin/reports/cod?from&to
 *            → { currency, period: [{ carrier, label, shipped, delivered, returned, cancelled, collected, fees|null, payouts }],
 *                balances: [{ carrier, label, collectedAllTime, feesAllTime|null, feesReported, payoutsAllTime, owed,
 *                             note: "paid_more_than_recorded"|"fees_more_than_collected"|null, lastPayoutOn|null }],
 *                outstanding: { orders, amount }, staff: { collected }, range }
 *   GET    /api/admin/reports/cod.csv?from&to                              (one row per courier balance)
 *   GET    /api/admin/reports/cod/outstanding?carrier&olderThanDays&limit&skip
 *            → { orders: [{ number, placedAt, shippedAt, carrier, consignmentId, deliveryStatus, codDue, daysSinceShipped }], total, limit, skip }
 *   GET    /api/admin/reports/cod/outstanding.csv?carrier&olderThanDays
 *   GET    /api/admin/courier-payouts?carrier&from&to&limit&skip
 *            → { payouts: [{ id, carrier, carrierLabel, amount, fees|null, currency, receivedOn, reference, note, adminName, createdAt }], total, limit, skip }
 *   POST   /api/admin/courier-payouts        { carrier, amount, fees?, receivedOn, reference?, note?, confirmDuplicate? } → 201 { payout }
 *            409 { message, duplicateOf: { id, … } }: the same courier, amount and date exist; send again with confirmDuplicate: true.
 *   PATCH  /api/admin/courier-payouts/:id    (any of the fields) → { payout }
 *   DELETE /api/admin/courier-payouts/:id    → { id, deleted } (a soft delete on the API)
 */

const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const LIVE_ONLY = 'This needs the BuyNest backend; the demo data has no cash reports.'
const live = (handler) => (ctx) => (realData() ? handler(ctx) : json({ message: LIVE_ONLY }, 404))
const fromLaravel = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))
const invalid = (errors) => json({ message: 'Please check the highlighted fields.', errors }, 422)

const MAX_PAGE = 100
const MAX_AMOUNT = 9_999_999_999.99 // decimal(12,2)
const isIdText = (value) => /^\d{1,9}$/.test(value ?? '')
const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
const dayParam = (url, key) => (isDay(url.searchParams.get(key)) ? url.searchParams.get(key) : undefined)
const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const OLDER_THAN = [7, 14, 30]

function pageParams(url) {
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), MAX_PAGE)
  const skip = Math.max(Number.parseInt(url.searchParams.get('skip') ?? '0', 10) || 0, 0)
  return { limit, skip }
}
const carrierParam = (url) => (PAYOUT_CARRIERS.includes(url.searchParams.get('carrier')) ? url.searchParams.get('carrier') : undefined)
const olderThanParam = (url) => {
  const days = Number(url.searchParams.get('olderThanDays'))
  return OLDER_THAN.includes(days) ? days : undefined
}

/** ?from&to&groupBy for the reports: well-formed values only. */
export function reportParams(url) {
  const params = new URLSearchParams()
  const from = dayParam(url, 'from')
  const to = dayParam(url, 'to')
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const groupBy = url.searchParams.get('groupBy')
  if (['day', 'week', 'month'].includes(groupBy)) params.set('group_by', groupBy)
  return params
}

/** ?carrier&older_than_days for the outstanding CSV. */
function outstandingParams(url) {
  const params = new URLSearchParams()
  const carrier = carrierParam(url)
  const olderThan = olderThanParam(url)
  if (carrier) params.set('carrier', carrier)
  if (olderThan) params.set('older_than_days', String(olderThan))
  return params
}

// ---- courier payments: the same rules and words as the API, checked here first ----

const isAmount = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT && hasCents(value)
const isFee = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_AMOUNT && hasCents(value)
// Today in UTC plus a day: the store's own time zone may be ahead of UTC (Dhaka: +6). The API judges "not in the future" exactly.
const latestDay = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
const optionalText = (value, max) => (value === undefined ? undefined : value === null ? null : typeof value === 'string' && value.trim().length <= max ? value.trim() || null : false)

/**
 * A courier payment: { carrier, amount, fees?, receivedOn, reference?, note?, confirmDuplicate? }
 * → { values } or { errors }. `partial` (an edit): only the fields sent, at least one.
 */
export function validateCourierPayout(body, { partial }) {
  const errors = {}
  const values = {}
  const has = (key) => body[key] !== undefined
  if (!partial || has('carrier')) {
    if (PAYOUT_CARRIERS.includes(body.carrier)) values.carrier = body.carrier
    else errors.carrier = ['Choose the courier that paid you.']
  }
  if (!partial || has('amount')) {
    if (isAmount(body.amount)) values.amount = Math.round(body.amount * 100) / 100
    else errors.amount = ['Enter the amount received, more than 0, with at most 2 decimals.']
  }
  if (has('fees')) {
    if (body.fees === null || body.fees === '') values.fees = null
    else if (isFee(body.fees)) values.fees = Math.round(body.fees * 100) / 100
    else errors.fees = ['Enter the fees the courier kept (0 or more, at most 2 decimals), or leave it empty.']
  }
  if (!partial || has('receivedOn')) {
    if (!isDay(body.receivedOn)) errors.receivedOn = ['Enter the date the money arrived.']
    else if (body.receivedOn < '2020-01-01') errors.receivedOn = ['Enter a date from 2020 on.']
    else if (body.receivedOn > latestDay()) errors.receivedOn = ["The date can't be in the future."]
    else values.receivedOn = body.receivedOn
  }
  for (const [key, max, message] of [
    ['reference', 100, 'Keep the reference to 100 characters.'],
    ['note', 500, 'Keep the note to 500 characters.'],
  ]) {
    const text = optionalText(body[key], max)
    if (text === false) errors[key] = [message]
    else if (text !== undefined) values[key] = text
  }
  if (has('confirmDuplicate')) {
    if (typeof body.confirmDuplicate === 'boolean') {
      if (body.confirmDuplicate) values.confirmDuplicate = true
    } else errors.confirmDuplicate = ['Confirm with true or false.']
  }
  if (partial && Object.keys(values).filter((key) => key !== 'confirmDuplicate').length === 0 && Object.keys(errors).length === 0) errors.amount = ['Change at least one field.']
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

// ---- CSV downloads ----

// The file name from the API's Content-Disposition, if it's a plain one; else ours.
function downloadName(disposition, report) {
  const name = /filename="?([A-Za-z0-9._-]{1,100})"?/.exec(disposition ?? '')?.[1]
  return name && name.endsWith('.csv') ? name : `buynest-${report.replaceAll('/', '-')}-report.csv`
}

/**
 * The API's CSV with its type and a safe download name. The API writes a BOM
 * (so Excel reads Bangla names as UTF-8); reading the answer as text drops
 * it, so it is put back, as for the phase 14 courier file.
 */
async function csvFile(ctx, report, params) {
  const file = await laravelFile(`/api/admin/v1/reports/${report}.csv?${params}`, { token: ctx.token, request: ctx.request })
  if (file.text === undefined) return json(failed(file).body, file.status)
  return new Response(file.text.startsWith('\uFEFF') ? file.text : `\uFEFF${file.text}`, {
    status: 200,
    headers: {
      'Content-Type': file.contentType.startsWith('text/csv') ? file.contentType : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${downloadName(file.disposition, report)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

// ---- the routes ----

const PHASE21_ROUTES = {
  'GET reports/payments': live(async (ctx) => fromLaravel(await laravelPhase21Data.payments(ctx.token, reportParams(ctx.url), ctx.request))),
  'GET reports/payments.csv': live((ctx) => csvFile(ctx, 'payments', reportParams(ctx.url))),
  'GET reports/cod': live(async (ctx) => fromLaravel(await laravelPhase21Data.cod(ctx.token, reportParams(ctx.url), ctx.request))),
  'GET reports/cod.csv': live((ctx) => csvFile(ctx, 'cod', reportParams(ctx.url))),
  'GET reports/cod/outstanding': live(async (ctx) => {
    const filters = { carrier: carrierParam(ctx.url), olderThanDays: olderThanParam(ctx.url), ...pageParams(ctx.url) }
    return fromLaravel(await laravelPhase21Data.outstanding(ctx.token, filters, ctx.request))
  }),
  'GET reports/cod/outstanding.csv': live((ctx) => csvFile(ctx, 'cod/outstanding', outstandingParams(ctx.url))),

  'GET courier-payouts': live(async (ctx) => {
    const filters = { carrier: carrierParam(ctx.url), from: dayParam(ctx.url, 'from'), to: dayParam(ctx.url, 'to'), ...pageParams(ctx.url) }
    return fromLaravel(await laravelPhase21Data.payouts(ctx.token, filters, ctx.request))
  }),
  'POST courier-payouts': live(async (ctx) => {
    const { values, errors } = validateCourierPayout(await readBody(ctx.request), { partial: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase21Data.createPayout(ctx.token, values, ctx.request), 201)
  }),
  'PATCH courier-payouts/:id': live(async (ctx) => {
    const { values, errors } = validateCourierPayout(await readBody(ctx.request), { partial: true })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase21Data.updatePayout(ctx.token, ctx.id, values, ctx.request))
  }),
  'DELETE courier-payouts/:id': live(async (ctx) => fromLaravel(await laravelPhase21Data.deletePayout(ctx.token, ctx.id, ctx.request), 200)),
}

/**
 * The phase 21 routes in adminApi.js's matcher: { route, id } for one of
 * them, null for a malformed address of theirs (404), undefined when not theirs.
 */
export function matchPhase21Route(method, segments) {
  const [first, second, third, fourth] = segments
  if (first === 'courier-payouts') {
    if (third !== undefined) return null
    if (second === undefined) return { route: PHASE21_ROUTES[`${method} courier-payouts`] }
    return isIdText(second) ? { route: PHASE21_ROUTES[`${method} courier-payouts/:id`], id: second } : null
  }
  if (first !== 'reports') return undefined
  if (second === 'payments' || second === 'payments.csv' || second === 'cod.csv') return third === undefined ? { route: PHASE21_ROUTES[`${method} reports/${second}`] } : null
  if (second !== 'cod') return undefined
  if (third === undefined) return { route: PHASE21_ROUTES[`${method} reports/cod`] }
  if ((third === 'outstanding' || third === 'outstanding.csv') && fourth === undefined) return { route: PHASE21_ROUTES[`${method} reports/cod/${third}`] }
  return null
}
