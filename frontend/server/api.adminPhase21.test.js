// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { failed } from './shop/adminSystem.js'
import { validateCourierPayout } from './adminPhase21Api.js'

/*
 * Phase 21 admin routes (adminPhase21Api.js, shop/adminPhase21.js) and the
 * phase 21 fields on the sales report, every report's range and the
 * settings. Laravel is faked with the snake_case shapes of
 * docs/backend/PHASE21_CONTRACT.md §1. Each mapping has a test: a field
 * missing from an allow-list was lost before (phase 17).
 */

const SITE = 'https://shop.example'
const ME = { id: 1, name: 'Store Owner', email: 'admin@buynest.test', role: { id: 1, name: 'Owner' }, permissions: ['reports.view', 'cash.manage', 'settings.view', 'settings.edit'] }

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const entry = { method: init.method ?? 'GET', path: pathname, search, headers: init.headers ?? {}, body: init.body }
    calls.push(entry)
    const key = `${entry.method} ${pathname}`
    const found = key === 'GET /api/admin/v1/me' ? { body: { data: ME } } : routes[key]
    const route = typeof found === 'function' ? found(entry) : (found ?? { status: 404, body: { message: 'Not found' } })
    if (route.text !== undefined) return new Response(route.text, { status: route.status ?? 200, headers: route.headers })
    return new Response(route.status === 204 ? null : JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

function admin(action, { method = 'GET', body } = {}) {
  return handleApiRequest(
    new Request(`${SITE}/api/admin/${action}`, {
      method,
      headers: { 'Sec-Fetch-Site': 'same-origin', Cookie: 'buynest_admin_at=9|ADMIN', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  )
}
const sent = (entry) => JSON.parse(entry.body)
const toApi = (calls) => calls.filter((entry) => entry.path !== '/api/admin/v1/me')
const query = (entry) => Object.fromEntries(new URLSearchParams(entry.search))

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const META = { from: '2026-11-01', to: '2026-11-28', group_by: 'day', currency: 'BDT', timezone: 'Asia/Dhaka' }
const PAYOUT = {
  id: 7,
  carrier: 'steadfast',
  carrier_label: 'Steadfast',
  amount: '9800.00',
  fees: '200.00',
  currency: 'BDT',
  received_on: '2026-11-27',
  reference: 'TRX-8812',
  note: 'Statement 41',
  admin_name: 'Store Owner',
  created_at: '2026-11-27T09:12:00Z',
  secret_column: 'never passed on',
}
const PAYOUT_OUT = {
  id: 7,
  carrier: 'steadfast',
  carrierLabel: 'Steadfast',
  amount: 9800,
  fees: 200,
  currency: 'BDT',
  receivedOn: '2026-11-27',
  reference: 'TRX-8812',
  note: 'Statement 41',
  adminName: 'Store Owner',
  createdAt: '2026-11-27T09:12:00Z',
}

describe('the sales report (REPORT_MAPS.sales) and every report range', () => {
  it('keeps by_payment_method and by_delivery_zone as byPaymentMethod / byDeliveryZone, and the time zone in range', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/reports/sales': {
        body: {
          data: {
            currency: 'BDT',
            totals: { orders: 3, units: 4, gross: '5000.00', discounts: '0.00', shipping: '120.00', tax: '0.00', refunds: '500.00', net: '4500.00', average_order: '1666.67' },
            series: [{ period: '2026-11-27', orders: 3, gross: '5000.00', refunds: '500.00', net: '4500.00' }],
            other_currencies: [],
            by_payment_method: [
              { method: 'cod', label: 'Cash on delivery', orders: 2, gross: '3000.00', refunds: '500.00', net: '2500.00', extra: 1 },
              { method: 'sslcommerz:bkash', label: 'bKash', orders: 1, gross: '2000.00', refunds: '0.00', net: '2000.00' },
              { method: 'Bad Method!', label: 'x', orders: 9 },
            ],
            by_delivery_zone: [
              { zone_code: 'inside_dhaka', name: 'Inside Dhaka', orders: 2, gross: '4000.00', refunds: '500.00', net: '3500.00' },
              { zone_code: null, name: 'No zone (outside Bangladesh or a free-text address)', orders: 1, gross: '1000.00', refunds: '0.00', net: '1000.00' },
            ],
          },
          meta: META,
        },
      },
    })
    const response = await admin('reports/sales?from=2026-11-01&to=2026-11-28&groupBy=day')
    expect(response.status).toBe(200)
    const report = await response.json()
    expect(report.byPaymentMethod).toEqual([
      { method: 'cod', label: 'Cash on delivery', orders: 2, gross: 3000, refunds: 500, net: 2500 },
      { method: 'sslcommerz:bkash', label: 'bKash', orders: 1, gross: 2000, refunds: 0, net: 2000 },
    ])
    expect(report.byDeliveryZone).toEqual([
      { zoneCode: 'inside_dhaka', name: 'Inside Dhaka', orders: 2, gross: 4000, refunds: 500, net: 3500 },
      { zoneCode: null, name: 'No zone (outside Bangladesh or a free-text address)', orders: 1, gross: 1000, refunds: 0, net: 1000 },
    ])
    expect(report.range).toEqual({ from: '2026-11-01', to: '2026-11-28', groupBy: 'day', timezone: 'Asia/Dhaka' })
    expect(report.totals.net).toBe(4500)
    expect(query(toApi(calls)[0])).toEqual({ from: '2026-11-01', to: '2026-11-28', group_by: 'day' })
  })

  it('leaves the breakdowns out for an older API, and the time zone out when it is missing or malformed', async () => {
    fakeLaravel({
      'GET /api/admin/v1/reports/sales': { body: { data: { totals: {}, series: [] }, meta: { from: '2026-11-01', to: '2026-11-28', timezone: 'Asia/Dhaka; DROP' } } },
      'GET /api/admin/v1/reports/products': { body: { data: [], meta: { from: '2026-11-01', to: '2026-11-28', timezone: 'UTC' } } },
    })
    const sales = await (await admin('reports/sales')).json()
    expect(sales).not.toHaveProperty('byPaymentMethod')
    expect(sales).not.toHaveProperty('byDeliveryZone')
    expect(sales.range).toEqual({ from: '2026-11-01', to: '2026-11-28' })
    // Every report in REPORT_MAPS gets range.timezone.
    expect((await (await admin('reports/products')).json()).range).toEqual({ from: '2026-11-01', to: '2026-11-28', timezone: 'UTC' })
  })
})

describe('Money in: GET reports/payments', () => {
  it('maps totals, channels, the series and other currencies, and passes the period on', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/reports/payments': {
        body: {
          data: {
            currency: 'BDT',
            totals: { received: '15300.00', online: '4000.00', cod_cash: '11000.00', other: '300.00', refunds: '500.00', net_received: '14800.00' },
            channels: [
              { channel: 'sslcommerz:bkash', label: 'bKash', amount: '4000.00', count: 2 },
              { channel: 'cash:steadfast', label: 'Cash collected by Steadfast', amount: '9800.00', count: 4 },
              { channel: 'cash:staff', label: 'Cash collected by staff', amount: '1200.00', count: 1 },
              { channel: 'other', label: 'Other', amount: '300.00', count: 1 },
              { channel: '<script>', label: 'x', amount: '1.00', count: 1 },
            ],
            series: [
              { period: '2026-11-26', online: '0.00', cod_cash: '0.00', other: '0.00', refunds: '0.00', net_received: '0.00' },
              { period: '2026-11-27', online: '4000.00', cod_cash: '11000.00', other: '300.00', refunds: '500.00', net_received: '14800.00' },
            ],
            other_currencies: [{ currency: 'USD', received: '80.00', count: 1, refunds: '0.00', net_received: '80.00' }],
          },
          meta: { ...META, from: '2026-11-26', to: '2026-11-27' },
        },
      },
    })
    const report = await (await admin('reports/payments?from=2026-11-26&to=2026-11-27&groupBy=week&evil=1')).json()
    expect(report).toEqual({
      currency: 'BDT',
      totals: { received: 15300, online: 4000, codCash: 11000, other: 300, refunds: 500, netReceived: 14800 },
      channels: [
        { channel: 'sslcommerz:bkash', label: 'bKash', amount: 4000, count: 2 },
        { channel: 'cash:steadfast', label: 'Cash collected by Steadfast', amount: 9800, count: 4 },
        { channel: 'cash:staff', label: 'Cash collected by staff', amount: 1200, count: 1 },
        { channel: 'other', label: 'Other', amount: 300, count: 1 },
      ],
      series: [
        { period: '2026-11-26', online: 0, codCash: 0, other: 0, refunds: 0, netReceived: 0 },
        { period: '2026-11-27', online: 4000, codCash: 11000, other: 300, refunds: 500, netReceived: 14800 },
      ],
      otherCurrencies: [{ currency: 'USD', received: 80, count: 1, refunds: 0, netReceived: 80 }],
      range: { from: '2026-11-26', to: '2026-11-27', groupBy: 'day', timezone: 'Asia/Dhaka' },
      live: true,
    })
    expect(query(toApi(calls)[0])).toEqual({ from: '2026-11-26', to: '2026-11-27', group_by: 'week' })
  })

  it('passes a 403 permission_denied on unchanged', async () => {
    fakeLaravel({ 'GET /api/admin/v1/reports/payments': { status: 403, body: { message: "Your role doesn't allow this.", code: 'permission_denied', permission: 'reports.view' } } })
    const response = await admin('reports/payments')
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ message: "Your role doesn't allow this.", code: 'permission_denied', permission: 'reports.view' })
  })
})

describe('Cash on delivery: GET reports/cod', () => {
  it('maps the period table, the balances (fees not reported stay null, a negative balance keeps its note), outstanding and staff', async () => {
    fakeLaravel({
      'GET /api/admin/v1/reports/cod': {
        body: {
          data: {
            currency: 'BDT',
            period: [
              { carrier: 'steadfast', label: 'Steadfast', shipped: 5, delivered: 3, returned: 1, cancelled: 0, collected: '9000.00', fees: '360.00', payouts: '8640.00' },
              { carrier: 'redx', label: 'RedX', shipped: 2, delivered: 1, returned: 0, cancelled: 1, collected: '1500.00', fees: null, payouts: '0.00' },
            ],
            balances: [
              {
                carrier: 'steadfast',
                label: 'Steadfast',
                collected_all_time: '20000.00',
                fees_all_time: '800.00',
                fees_reported: true,
                payouts_all_time: '6860.00',
                owed: '12340.00',
                note: null,
                last_payout_on: '2026-11-20',
              },
              { carrier: 'redx', label: 'RedX', collected_all_time: '1500.00', fees_all_time: null, fees_reported: false, payouts_all_time: '2000.00', owed: '-500.00', note: 'paid_more_than_recorded', last_payout_on: null },
              // Return fees beyond the cash, nothing paid yet: the shop owes the courier.
              { carrier: 'pathao', label: 'Pathao', collected_all_time: '200.00', fees_all_time: '240.00', fees_reported: true, payouts_all_time: '0.00', owed: '-40.00', note: 'fees_more_than_collected', last_payout_on: null },
              { carrier: 'paperfly', label: 'Paperfly', collected_all_time: '100.00', fees_all_time: '0.00', fees_reported: true, payouts_all_time: '0.00', owed: '100.00', note: '<b>unknown</b>', last_payout_on: null },
            ],
            outstanding: { orders: 4, amount: '6200.00' },
            staff: { collected: '1200.00' },
          },
          meta: { from: '2026-11-01', to: '2026-11-28', timezone: 'Asia/Dhaka' },
        },
      },
    })
    const report = await (await admin('reports/cod?from=2026-11-01&to=2026-11-28')).json()
    expect(report.period).toEqual([
      { carrier: 'steadfast', label: 'Steadfast', shipped: 5, delivered: 3, returned: 1, cancelled: 0, collected: 9000, fees: 360, payouts: 8640 },
      { carrier: 'redx', label: 'RedX', shipped: 2, delivered: 1, returned: 0, cancelled: 1, collected: 1500, fees: null, payouts: 0 },
    ])
    expect(report.balances).toEqual([
      { carrier: 'steadfast', label: 'Steadfast', collectedAllTime: 20000, feesAllTime: 800, feesReported: true, payoutsAllTime: 6860, owed: 12340, note: null, lastPayoutOn: '2026-11-20' },
      { carrier: 'redx', label: 'RedX', collectedAllTime: 1500, feesAllTime: null, feesReported: false, payoutsAllTime: 2000, owed: -500, note: 'paid_more_than_recorded', lastPayoutOn: null },
      { carrier: 'pathao', label: 'Pathao', collectedAllTime: 200, feesAllTime: 240, feesReported: true, payoutsAllTime: 0, owed: -40, note: 'fees_more_than_collected', lastPayoutOn: null },
      { carrier: 'paperfly', label: 'Paperfly', collectedAllTime: 100, feesAllTime: 0, feesReported: true, payoutsAllTime: 0, owed: 100, note: null, lastPayoutOn: null },
    ])
    expect(report.outstanding).toEqual({ orders: 4, amount: 6200 })
    expect(report.staff).toEqual({ collected: 1200 })
    expect(report.currency).toBe('BDT')
    expect(report.range).toEqual({ from: '2026-11-01', to: '2026-11-28', timezone: 'Asia/Dhaka' })
  })

  it('lists the orders still to collect, with only known filters, as page and per_page', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/reports/cod/outstanding': {
        body: {
          data: [
            {
              number: 'BN-100045',
              placed_at: '2026-11-01T10:00:00Z',
              shipped_at: '2026-11-02T08:00:00Z',
              carrier: 'steadfast',
              consignment_id: 'SF-778812',
              delivery_status: 'in_transit',
              cod_due: '1550.00',
              days_since_shipped: 26,
              customer_phone: 'not passed on',
            },
          ],
          meta: { total: 41, currency: 'BDT' },
        },
      },
    })
    const answer = await (await admin('reports/cod/outstanding?carrier=steadfast&olderThanDays=14&limit=20&skip=20')).json()
    expect(answer).toEqual({
      orders: [{ number: 'BN-100045', placedAt: '2026-11-01T10:00:00Z', shippedAt: '2026-11-02T08:00:00Z', carrier: 'steadfast', consignmentId: 'SF-778812', deliveryStatus: 'in_transit', codDue: 1550, daysSinceShipped: 26 }],
      total: 41,
      currency: 'BDT',
      limit: 20,
      skip: 20,
      live: true,
    })
    expect(query(toApi(calls)[0])).toEqual({ carrier: 'steadfast', older_than_days: '14', page: '2', per_page: '20' })

    await admin('reports/cod/outstanding?carrier=dhl&olderThanDays=3')
    expect(query(toApi(calls)[1])).toEqual({ page: '1', per_page: '20' })
  })

  it('refuses malformed report addresses', async () => {
    fakeLaravel({})
    expect((await admin('reports/cod/elsewhere')).status).toBe(404)
    expect((await admin('reports/payments/extra')).status).toBe(404)
    expect((await admin('courier-payouts/abc')).status).toBe(404)
    expect((await admin('courier-payouts/7/extra')).status).toBe(404)
  })
})

describe('the CSV downloads', () => {
  it('passes the API files on with their BOM and a safe name: payments, cod and outstanding', async () => {
    const csv = '﻿channel,label,amount\r\ncash:steadfast,Steadfast,9800.00\r\n'
    const calls = fakeLaravel({
      'GET /api/admin/v1/reports/payments.csv': { text: csv, headers: { 'Content-Type': 'text/csv; charset=UTF-8', 'Content-Disposition': 'attachment; filename="payments-2026-11-01-to-2026-11-28.csv"' } },
      'GET /api/admin/v1/reports/cod.csv': { text: csv, headers: { 'Content-Type': 'text/csv; charset=UTF-8', 'Content-Disposition': 'attachment; filename="../../etc/passwd"' } },
      'GET /api/admin/v1/reports/cod/outstanding.csv': { text: csv, headers: { 'Content-Type': 'text/csv; charset=UTF-8' } },
    })
    const payments = await admin('reports/payments.csv?from=2026-11-01&to=2026-11-28')
    expect(payments.status).toBe(200)
    expect(payments.headers.get('content-disposition')).toBe('attachment; filename="payments-2026-11-01-to-2026-11-28.csv"')
    const bytes = new Uint8Array(await payments.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])

    const cod = await admin('reports/cod.csv?from=2026-11-01&to=2026-11-28')
    expect(cod.headers.get('content-disposition')).toBe('attachment; filename="buynest-cod-report.csv"')
    const outstanding = await admin('reports/cod/outstanding.csv?carrier=pathao&olderThanDays=30')
    expect(outstanding.headers.get('content-disposition')).toBe('attachment; filename="buynest-cod-outstanding-report.csv"')
    expect(outstanding.headers.get('content-type')).toBe('text/csv; charset=UTF-8')
    expect(query(toApi(calls)[2])).toEqual({ carrier: 'pathao', older_than_days: '30' })
  })

  it('passes an error on as JSON', async () => {
    fakeLaravel({ 'GET /api/admin/v1/reports/cod.csv': { status: 403, body: { message: 'No.', code: 'permission_denied', permission: 'reports.view' } } })
    const response = await admin('reports/cod.csv')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'permission_denied', permission: 'reports.view' })
  })
})

describe('courier payments', () => {
  it('lists them with known filters only, every field mapped and nothing else', async () => {
    const calls = fakeLaravel({ 'GET /api/admin/v1/courier-payouts': { body: { data: [PAYOUT, { ...PAYOUT, id: 8, fees: null, reference: null, note: null }], meta: { total: 2 } } } })
    const answer = await (await admin('courier-payouts?carrier=steadfast&from=2026-11-01&to=2026-11-28&limit=20&skip=0&evil=1')).json()
    expect(answer.payouts).toEqual([PAYOUT_OUT, { ...PAYOUT_OUT, id: 8, fees: null, reference: null, note: null }])
    expect(answer.total).toBe(2)
    expect(query(toApi(calls)[0])).toEqual({ carrier: 'steadfast', from: '2026-11-01', to: '2026-11-28', page: '1', per_page: '20' })
  })

  it('records one: money as 2-decimal strings, snake_case, 201 with the payment', async () => {
    const calls = fakeLaravel({ 'POST /api/admin/v1/courier-payouts': { status: 201, body: { data: PAYOUT } } })
    const response = await admin('courier-payouts', { method: 'POST', body: { carrier: 'steadfast', amount: 9800, fees: 200, receivedOn: '2026-11-27', reference: ' TRX-8812 ', note: 'Statement 41', extra: 'x' } })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ payout: PAYOUT_OUT, live: true })
    expect(sent(toApi(calls)[0])).toEqual({ carrier: 'steadfast', amount: '9800.00', fees: '200.00', received_on: '2026-11-27', reference: 'TRX-8812', note: 'Statement 41' })
  })

  it('keeps the 409 duplicate_of as duplicateOf (allow-listed), and sends confirm_duplicate on the second try', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/courier-payouts': (entry) =>
        JSON.parse(entry.body).confirm_duplicate
          ? { status: 201, body: { data: { ...PAYOUT, id: 9 } } }
          : { status: 409, body: { message: 'A payment from Steadfast of ৳9,800.00 on 27 Nov 2026 is already recorded.', duplicate_of: PAYOUT } },
    })
    const values = { carrier: 'steadfast', amount: 9800, receivedOn: '2026-11-27' }
    const first = await admin('courier-payouts', { method: 'POST', body: values })
    expect(first.status).toBe(409)
    expect(await first.json()).toEqual({ message: 'A payment from Steadfast of ৳9,800.00 on 27 Nov 2026 is already recorded.', duplicateOf: PAYOUT_OUT })

    const second = await admin('courier-payouts', { method: 'POST', body: { ...values, confirmDuplicate: true } })
    expect(second.status).toBe(201)
    expect((await second.json()).payout.id).toBe(9)
    expect(sent(toApi(calls)[1])).toEqual({ carrier: 'steadfast', amount: '9800.00', received_on: '2026-11-27', confirm_duplicate: true })
  })

  it('keeps a bare id as duplicateOf too, and failed() keeps only the id by default', async () => {
    fakeLaravel({ 'POST /api/admin/v1/courier-payouts': { status: 409, body: { message: 'Already recorded.', duplicate_of: 7 } } })
    const response = await admin('courier-payouts', { method: 'POST', body: { carrier: 'pathao', amount: 500, receivedOn: '2026-11-20' } })
    expect(await response.json()).toEqual({ message: 'Already recorded.', duplicateOf: { id: 7 } })
    expect(failed({ status: 409, data: { message: 'x', duplicate_of: { id: 3, secret: 'y' } } }).body).toEqual({ message: 'x', duplicateOf: { id: 3 } })
    expect(failed({ status: 409, data: { message: 'x', duplicate_of: 'nope' } }).body).toEqual({ message: 'x' })
  })

  it('checks the fields first with the same words as the API', async () => {
    const calls = fakeLaravel({})
    const response = await admin('courier-payouts', { method: 'POST', body: { carrier: 'dhl', amount: 0, fees: -1, receivedOn: '2019-12-31', reference: 'x'.repeat(101) } })
    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual({
      carrier: ['Choose the courier that paid you.'],
      amount: ['Enter the amount received, more than 0, with at most 2 decimals.'],
      fees: ['Enter the fees the courier kept (0 or more, at most 2 decimals), or leave it empty.'],
      receivedOn: ['Enter a date from 2020 on.'],
      reference: ['Keep the reference to 100 characters.'],
    })
    expect(toApi(calls)).toHaveLength(0)
    expect(validateCourierPayout({ carrier: 'pathao', amount: 10.005, receivedOn: '2026-02-30' }, { partial: false }).errors).toEqual({
      amount: ['Enter the amount received, more than 0, with at most 2 decimals.'],
      receivedOn: ['Enter the date the money arrived.'],
    })
    expect(validateCourierPayout({ carrier: 'pathao', amount: 10, receivedOn: '2999-01-01' }, { partial: false }).errors).toEqual({ receivedOn: ["The date can't be in the future."] })
    expect(validateCourierPayout({}, { partial: true }).errors).toEqual({ amount: ['Change at least one field.'] })
    expect(validateCourierPayout({ fees: '', reference: '' }, { partial: true }).values).toEqual({ fees: null, reference: null })
  })

  it("maps the API's 422 field names back (received_on → receivedOn)", async () => {
    fakeLaravel({ 'POST /api/admin/v1/courier-payouts': { status: 422, body: { message: 'The given data was invalid.', errors: { received_on: ["The date can't be in the future."] } } } })
    const response = await admin('courier-payouts', { method: 'POST', body: { carrier: 'steadfast', amount: 100, receivedOn: '2026-11-28' } })
    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual({ receivedOn: ["The date can't be in the future."] })
  })

  it('edits only the fields sent and deletes one', async () => {
    const calls = fakeLaravel({
      'PATCH /api/admin/v1/courier-payouts/7': { body: { data: { ...PAYOUT, amount: '9700.00', fees: null } } },
      'DELETE /api/admin/v1/courier-payouts/7': { status: 204 },
    })
    const edited = await admin('courier-payouts/7', { method: 'PATCH', body: { amount: 9700, fees: null } })
    expect(edited.status).toBe(200)
    expect((await edited.json()).payout).toEqual({ ...PAYOUT_OUT, amount: 9700, fees: null })
    expect(sent(toApi(calls)[0])).toEqual({ amount: '9700.00', fees: null })

    const removed = await admin('courier-payouts/7', { method: 'DELETE' })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ id: 7, deleted: true, live: true })
  })

  it('passes a 403 on a write (reports.view without cash.manage) unchanged', async () => {
    fakeLaravel({ 'POST /api/admin/v1/courier-payouts': { status: 403, body: { message: "Your role doesn't allow this.", code: 'permission_denied', permission: 'cash.manage' } } })
    const response = await admin('courier-payouts', { method: 'POST', body: { carrier: 'steadfast', amount: 100, receivedOn: '2026-11-20' } })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ message: "Your role doesn't allow this.", code: 'permission_denied', permission: 'cash.manage' })
  })

  it('needs the BuyNest backend', async () => {
    vi.stubEnv('VITE_API_PROVIDER', 'dummyjson')
    fakeLaravel({})
    expect((await admin('courier-payouts')).status).toBe(404)
    expect((await admin('reports/cod')).status).toBe(404)
  })
})

describe('Settings → General → Time zone', () => {
  it('reads store_timezone as storeTimezone and sends it back under its API name', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/settings': { body: { data: { general: { store_name: 'BuyNest', store_timezone: 'UTC' } } } },
      'PATCH /api/admin/v1/settings': (entry) => ({ body: { data: { general: { store_name: 'BuyNest', store_timezone: sent(entry).general.store_timezone } } } }),
    })
    expect((await (await admin('settings')).json()).general).toEqual({ storeName: 'BuyNest', storeTimezone: 'UTC' })
    const saved = await admin('settings', { method: 'PATCH', body: { general: { storeTimezone: 'Asia/Dhaka' } } })
    expect(saved.status).toBe(200)
    expect((await saved.json()).general.storeTimezone).toBe('Asia/Dhaka')
    expect(sent(toApi(calls)[1])).toEqual({ general: { store_timezone: 'Asia/Dhaka' } })
  })

  it('refuses a zone that does not exist', async () => {
    fakeLaravel({})
    for (const zone of ['Mars/Olympus', 'Asia/Dhaka; DROP', 6, '']) {
      const response = await admin('settings', { method: 'PATCH', body: { general: { storeTimezone: zone } } })
      expect(response.status).toBe(422)
      expect((await response.json()).errors).toEqual({ 'general.storeTimezone': ['Choose a time zone from the list.'] })
    }
  })
})
