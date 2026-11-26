// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

// Phase 18 (docs/backend/PHASE18_CONTRACT.md §3): a courier's delivery progress reaches the customer's
// orders and the guest order lookup through the BFF's whitelist, and nothing staff-only does.
const SITE = 'https://shop.example'

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    calls.push({ path: pathname, search, init })
    const route = routes[`${init.method ?? 'GET'} ${pathname}`] ?? { status: 404, body: { message: 'Not found' } }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}
const call = (action, { method = 'GET', body, cookie } = {}) =>
  handleApiRequest(
    new Request(`${SITE}/api/shop/${action}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }) },
      body: body && JSON.stringify(body),
    }),
  )

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const TOTALS = { item_count: 1, subtotal: '1250.00', discount: '0.00', shipping: '60.00', tax: '0.00', total: '1310.00' }
const ADDRESS = { first_name: 'Rahim', last_name: 'Uddin', line1: 'House 12', line2: null, city: 'Dhaka', state: 'Dhaka', postal_code: '1207', country: 'Bangladesh' }
const ORDER = {
  number: 'BN-100001', status: 'shipped', payment_status: 'unpaid', payment_method: 'cod', shipping_method: { id: 'standard', label: 'Standard', eta: '1–2 days' },
  email: 'rahim@example.com', phone: '+8801711000000', shipping_address: ADDRESS, billing_address: ADDRESS, items: [], totals: TOTALS, placed_at: '2026-11-20T09:00:00Z', currency: 'BDT',
}
// A courier shipment as the API sends it, plus keys that must never reach the browser.
const COURIER_SHIPMENT = {
  number: 'SHP-100001', order_number: 'BN-100001', carrier: 'steadfast', carrier_label: 'Steadfast', tracking_number: 'SFR123ABC', tracking_url: 'https://steadfast.com.bd/t/SFR123ABC',
  created_at: '2026-11-21T10:00:00Z', admin_name: null, note: null,
  delivery_status: 'in_transit', delivery_status_label: 'On the way',
  events: [
    { delivery_status: 'booked', label: 'Booked', message: null, occurred_at: '2026-11-21T10:00:00Z', courier_status: 'in_review', source: 'booking' },
    { delivery_status: 'in_transit', label: 'On the way', message: 'Reached the Dhaka hub', occurred_at: '2026-11-22T08:30:00Z', courier_status: 'pending', source: 'webhook' },
  ],
  courier_status: 'pending', courier_fee: '60.00', collected: '0.00', cod_amount: '1310.00', courier: { key: 'steadfast', consignment_id: '9999' },
}
const EXPECTED = {
  number: 'SHP-100001', carrier: 'steadfast', carrierLabel: 'Steadfast', trackingNumber: 'SFR123ABC', trackingUrl: 'https://steadfast.com.bd/t/SFR123ABC', createdAt: '2026-11-21T10:00:00Z',
  deliveryStatus: 'in_transit', deliveryStatusLabel: 'On the way',
  events: [
    { deliveryStatus: 'booked', label: 'Booked', message: null, occurredAt: '2026-11-21T10:00:00Z' },
    { deliveryStatus: 'in_transit', label: 'On the way', message: 'Reached the Dhaka hub', occurredAt: '2026-11-22T08:30:00Z' },
  ],
}
const STAFF_ONLY = ['courier_status', 'courierStatus', 'courier_fee', 'courierFee', 'collected', 'cod_amount', 'codAmount', 'consignment', 'source', '9999']

describe('courier delivery progress through the BFF', () => {
  it("a customer's order passes delivery status, label, tracking link and updates, nothing staff-only", async () => {
    fakeLaravel({ 'GET /api/v1/orders/BN-100001': { body: { data: { ...ORDER, shipments: [COURIER_SHIPMENT] } } } })
    const response = await call('orders/BN-100001', { cookie: 'buynest_at=1|ACCESS' })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(JSON.parse(text).shipments).toEqual([EXPECTED])
    for (const key of STAFF_ONLY) expect(text, key).not.toContain(key)
  })

  it('the order list carries each shipment’s delivery status (the "Delivery: On the way" label)', async () => {
    fakeLaravel({ 'GET /api/v1/orders': { body: { data: [{ ...ORDER, shipments: [COURIER_SHIPMENT] }], meta: { total: 1, current_page: 1, per_page: 10, last_page: 1 } } } })
    const list = await (await call('orders?page=1', { cookie: 'buynest_at=1|ACCESS' })).json()
    expect(list.orders[0].shipments[0]).toMatchObject({ deliveryStatus: 'in_transit', deliveryStatusLabel: 'On the way' })
  })

  it('the guest order lookup passes the same fields', async () => {
    fakeLaravel({ 'POST /api/v1/orders/lookup': { body: { data: { ...ORDER, shipments: [COURIER_SHIPMENT] } } } })
    const response = await call('orders/lookup', { method: 'POST', body: { number: 'BN-100001', email: 'rahim@example.com' } })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(JSON.parse(text).shipments).toEqual([EXPECTED])
    for (const key of STAFF_ONLY) expect(text, key).not.toContain(key)
  })

  it('manual shipments keep "shipped"; unknown statuses, bad events and unsafe links are dropped; older answers are unchanged', async () => {
    const shipments = [
      { ...COURIER_SHIPMENT, number: 'SHP-1', carrier: 'ups', carrier_label: 'UPS', tracking_url: 'https://www.ups.com/track?tracknum=1Z', delivery_status: 'shipped', delivery_status_label: 'Shipped', events: [] },
      { ...COURIER_SHIPMENT, number: 'SHP-2', delivery_status: 'teleported', tracking_url: 'javascript:alert(1)' },
      { ...COURIER_SHIPMENT, number: 'SHP-3', events: [null, 'x', { delivery_status: 'nope', occurred_at: 'T' }, { delivery_status: 'booked' }, { delivery_status: 'delivered', label: 7, message: 'x'.repeat(900), occurred_at: 'T9' }] },
      { number: 'SHP-4', carrier: 'dhl', carrier_label: 'DHL', tracking_number: 'JD1', tracking_url: 'https://www.dhl.com/x', created_at: 'T4' },
    ]
    fakeLaravel({ 'GET /api/v1/orders/BN-100001': { body: { data: { ...ORDER, shipments } } } })
    const order = await (await call('orders/BN-100001', { cookie: 'buynest_at=1|ACCESS' })).json()
    expect(order.shipments[0]).toMatchObject({ deliveryStatus: 'shipped', deliveryStatusLabel: 'Shipped', events: [], trackingUrl: 'https://www.ups.com/track?tracknum=1Z' })
    expect(order.shipments[1]).not.toHaveProperty('deliveryStatus')
    expect(order.shipments[1]).not.toHaveProperty('events')
    expect(order.shipments[1].trackingUrl).toBeNull()
    expect(order.shipments[2].events).toEqual([{ deliveryStatus: 'delivered', label: null, message: 'x'.repeat(500), occurredAt: 'T9' }])
    expect(order.shipments[3]).toEqual({ number: 'SHP-4', carrier: 'dhl', carrierLabel: 'DHL', trackingNumber: 'JD1', trackingUrl: 'https://www.dhl.com/x', createdAt: 'T4' })
  })
})
