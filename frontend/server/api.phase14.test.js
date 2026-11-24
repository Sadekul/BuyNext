// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

// Phase 14 (docs/backend/PHASE14_CONTRACT.md): Bangladesh's places through the public catalog, and the
// shop service passing Bangladesh addresses, delivery zones and cash on delivery both ways.
const SITE = 'https://shop.example'

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    calls.push({ path: pathname, search, init, body: init.body ? JSON.parse(init.body) : undefined })
    const route = routes[`${init.method ?? 'GET'} ${pathname}`] ?? { status: 404, body: { message: 'Not found' } }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}
const SAME = { 'Sec-Fetch-Site': 'same-origin', Origin: SITE }
const request = (path, { method = 'GET', headers = {}, body } = {}) =>
  handleApiRequest(new Request(`${SITE}${path}`, { method, headers: { ...SAME, ...(body && { 'Content-Type': 'application/json' }), ...headers }, body: body && JSON.stringify(body) }))

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
  vi.stubEnv('BUYNEST_BFF_KEY', 'shared-secret')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Bangladesh places (public catalog)', () => {
  const AREA = { id: 1001, district_id: 47, name: 'ধানমন্ডি', name_en: 'Dhanmondi', name_bn: 'ধানমন্ডি', kind: 'thana', city_corporation: 'Dhaka South', postcodes: ['1205', '1209'], secret: 'x' }

  it('forwards the three lists with only a numeric parent id, cached for an hour', async () => {
    const calls = fakeLaravel({
      'GET /api/v1/places/bd/divisions': { body: { data: [{ id: 3, name: 'Dhaka', name_en: 'Dhaka', name_bn: 'ঢাকা' }] } },
      'GET /api/v1/places/bd/districts': { body: { data: [{ id: 47, division_id: 3, name: 'Dhaka', name_en: 'Dhaka', name_bn: 'ঢাকা' }] } },
      'GET /api/v1/places/bd/areas': { body: { data: [AREA] } },
    })
    const divisions = await request('/api/catalog/places/bd/divisions')
    expect(divisions.status).toBe(200)
    expect(divisions.headers.get('Cache-Control')).toBe('public, max-age=3600')
    expect((await divisions.json()).data).toEqual([{ id: 3, name: 'Dhaka', name_en: 'Dhaka', name_bn: 'ঢাকা' }])
    await request('/api/catalog/places/bd/districts?division=3&evil=1')
    await request('/api/catalog/places/bd/districts')
    const areas = await request('/api/catalog/places/bd/areas?district=47&lang=bn')
    const { secret, ...shown } = AREA
    expect(secret).toBe('x')
    expect((await areas.json()).data).toEqual([shown])
    expect(calls.map((call) => `${call.path}${call.search}`)).toEqual([
      '/api/v1/places/bd/divisions',
      '/api/v1/places/bd/districts?division=3',
      '/api/v1/places/bd/districts',
      '/api/v1/places/bd/areas?district=47',
    ])
    expect(calls[3].init.headers['Accept-Language']).toBe('bn')
  })

  it('refuses anything else (no area list without a district, other countries, writes)', async () => {
    const calls = fakeLaravel({})
    for (const path of ['/api/catalog/places/bd/areas', '/api/catalog/places/bd/areas?district=abc', '/api/catalog/places/in/divisions', '/api/catalog/places/bd/divisions/1', '/api/catalog/places/bd/zones']) {
      expect((await request(path)).status).toBe(404)
    }
    expect((await request('/api/catalog/places/bd/divisions', { method: 'POST', body: {} })).status).toBe(405)
    expect(calls).toEqual([])
  })
})

const LINE = { product_id: 1, name: 'Mascara', price: '1100.00', sale_price: '1100.00', quantity: 2, line_total: '2200.00', stock_quantity: 9, available: true }
const ZONE = { code: 'inside_dhaka', name: 'Inside Dhaka', name_en: 'Inside Dhaka', name_bn: 'ঢাকার ভেতরে' }

describe('cart pricing for a Bangladesh address', () => {
  it('sends the area and district (not the division) and the payment method; answers zone, ETA and COD', async () => {
    const calls = fakeLaravel({
      'POST /api/v1/cart/validate': {
        body: {
          data: {
            lines: [LINE],
            shipping_options: [{ id: 'standard', label: 'Standard', eta: 'Delivery in 1–2 days', price: '80.00', eta_days_min: 1, eta_days_max: 2, zone_code: 'inside_dhaka' }],
            delivery_zone: ZONE,
            cod: { available: false, reason: 'limit', message: 'Cash on delivery is available for orders up to ৳2,000.00.', fee: '20.00', max_order_total: '2000.00', advance: 'delivery_charge', advance_amount: '100.00' },
            totals: { item_count: 2, subtotal: '2200.00', shipping: '80.00', tax: '0.00', total: '2300.00', cod_fee: '20.00' },
          },
        },
      },
    })
    const response = await request('/api/shop/cart/validate', {
      method: 'POST',
      body: { items: [{ productId: 1, quantity: 2 }], shippingMethod: 'standard', country: 'Bangladesh', place: { divisionId: '3', districtId: '47', areaId: '1001' }, paymentMethod: 'cod' },
    })
    expect(calls[0].body).toMatchObject({ country: 'Bangladesh', district_id: 47, area_id: 1001, payment_method: 'cod' })
    expect(calls[0].body).not.toHaveProperty('division_id')
    const cart = await response.json()
    expect(cart.shippingOptions).toEqual([{ id: 'standard', label: 'Standard', eta: 'Delivery in 1–2 days', price: 80, etaDaysMin: 1, etaDaysMax: 2, zone: { code: 'inside_dhaka', name: null, nameEn: null, nameBn: null } }])
    expect(cart.deliveryZone).toEqual({ code: 'inside_dhaka', name: 'Inside Dhaka', nameEn: 'Inside Dhaka', nameBn: 'ঢাকার ভেতরে' })
    expect(cart.cod).toMatchObject({ available: false, reason: 'limit', fee: 20, maxOrderTotal: 2000, advance: 'delivery_charge', advanceAmount: 100 })
    expect(cart.totals.codFee).toBe(20)
  })

  it('sends no place for other countries, and answers exactly as before without the phase 14 keys', async () => {
    const calls = fakeLaravel({ 'POST /api/v1/cart/validate': { body: { data: { lines: [LINE], shipping_options: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: '4.99' }], totals: { total: '24.99' } } } } })
    const cart = await (await request('/api/shop/cart/validate', { method: 'POST', body: { items: [{ productId: 1, quantity: 2 }], country: 'India', place: { divisionId: 3, districtId: 47, areaId: 1001 } } })).json()
    expect(calls[0].body).not.toHaveProperty('area_id')
    expect(calls[0].body).not.toHaveProperty('payment_method')
    expect(cart.shippingOptions).toEqual([{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: 4.99 }])
    expect(cart).not.toHaveProperty('cod')
    expect(cart).not.toHaveProperty('deliveryZone')
    expect(cart.totals).not.toHaveProperty('codFee')
  })
})

const BD_ADDRESS = { firstName: 'Rahim', lastName: 'Uddin', line1: 'House 12', line2: '', city: '', state: '', postalCode: '', country: 'Bangladesh', divisionId: '3', districtId: '47', areaId: '1001' }
const ORDER = {
  number: 'BN-100001', status: 'pending_payment', payment_status: 'unpaid', payment_method: 'cod', email: 'r@example.com', phone: '+8801712345678',
  shipping_method: { id: 'standard', label: 'Standard', eta: 'Delivery in 1–2 days' },
  shipping_address: { first_name: 'Rahim', last_name: 'Uddin', line1: 'House 12', city: 'Dhaka', state: 'Dhaka', postal_code: null, country: 'Bangladesh', division_id: 3, district_id: 47, area_id: 1001, area: 'Dhanmondi' },
  items: [LINE], totals: { total: '2320.00', cod_fee: '20.00' }, placed_at: '2026-11-23T10:00:00Z',
  payment: { provider: 'sslcommerz', url: 'https://sandbox.sslcommerz.com/gw/abc', can_pay: true },
  delivery: { zone_code: 'inside_dhaka', zone_name: 'Inside Dhaka', eta_days_min: 1, eta_days_max: 2, eta: 'Delivery in 1–2 days' },
  cod: { fee: '20.00', advance_amount: '100.00', advance_paid: '0.00', cod_due: '2320.00' },
  confirmation_status: 'pending',
}

describe('orders with a Bangladesh address and cash on delivery', () => {
  it('sends the place ids of a Bangladesh address only, and passes zone, advance, cash due and confirmation back', async () => {
    const calls = fakeLaravel({ 'POST /api/v1/orders': { status: 201, body: { data: ORDER } } })
    const response = await request('/api/shop/orders', {
      method: 'POST',
      body: { items: [{ productId: 1, quantity: 2 }], shippingMethod: 'standard', paymentMethod: 'cod', email: 'r@example.com', phone: '+8801712345678', shippingAddress: BD_ADDRESS, billingAddress: { ...BD_ADDRESS, country: 'India' }, expectedTotal: 2320 },
    })
    expect(response.status).toBe(201)
    expect(calls[0].body.shipping_address).toMatchObject({ country: 'Bangladesh', division_id: 3, district_id: 47, area_id: 1001 })
    expect(calls[0].body.billing_address).not.toHaveProperty('area_id')
    const order = await response.json()
    expect(order.shippingAddress).toMatchObject({ divisionId: 3, districtId: 47, areaId: 1001, area: { id: 1001, nameEn: 'Dhanmondi', nameBn: null } })
    expect(order.shippingMethod).toEqual({ id: 'standard', label: 'Standard', eta: 'Delivery in 1–2 days', etaDaysMin: 1, etaDaysMax: 2 })
    expect(order).toMatchObject({ deliveryZone: { code: 'inside_dhaka', name: 'Inside Dhaka' }, codFee: 20, advanceAmount: 100, advancePaid: 0, codDue: 2320, confirmationStatus: 'pending' })
    expect(order.payment).toMatchObject({ provider: 'sslcommerz', canPay: true })
  })

  it('a refused cash on delivery comes back on the payment method field', async () => {
    fakeLaravel({ 'POST /api/v1/orders': { status: 422, body: { message: "Cash on delivery isn't available in your area.", errors: { payment_method: ["Cash on delivery isn't available in your area."] } } } })
    const response = await request('/api/shop/orders', { method: 'POST', body: { items: [], paymentMethod: 'cod' } })
    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual({ paymentMethod: ["Cash on delivery isn't available in your area."] })
  })

  it('an order without the phase 14 keys keeps its old shape', async () => {
    const { delivery, cod, confirmation_status: confirmation, ...old } = ORDER
    expect([delivery, cod, confirmation].every(Boolean)).toBe(true)
    fakeLaravel({ 'POST /api/v1/orders/lookup': { body: { data: { ...old, shipping_address: { first_name: 'A', last_name: 'B', line1: '1 Road', city: 'Pune', state: 'MH', postal_code: '411001', country: 'India' } } } } })
    const order = await (await request('/api/shop/orders/lookup', { method: 'POST', body: { number: 'BN-100001', email: 'r@example.com' } })).json()
    expect(order.shippingAddress).toEqual({ firstName: 'A', lastName: 'B', line1: '1 Road', line2: '', city: 'Pune', state: 'MH', postalCode: '411001', country: 'India' })
    for (const key of ['deliveryZone', 'advancePaid', 'codDue', 'confirmationStatus']) expect(order).not.toHaveProperty(key)
  })
})

describe('the address book', () => {
  const signedIn = { cookie: 'buynest_at=token; buynest_session=1' }

  it('saves a Bangladesh address with its place ids and reads them back', async () => {
    const calls = fakeLaravel({
      'POST /api/v1/me/addresses': { status: 201, body: { data: { id: 9, first_name: 'Rahim', last_name: 'Uddin', phone: '+8801712345678', line1: 'House 12', city: 'Dhaka', state: 'Dhaka', postal_code: null, country: 'Bangladesh', division_id: 3, district_id: 47, area_id: 1001 } } },
    })
    const response = await request('/api/shop/me/addresses', { method: 'POST', headers: signedIn, body: { ...BD_ADDRESS, phone: '01712-345678' } })
    expect(response.status).toBe(201)
    expect(calls.at(-1).body).toMatchObject({ division_id: 3, district_id: 47, area_id: 1001, country: 'Bangladesh' })
    expect(await response.json()).toMatchObject({ id: 9, divisionId: 3, districtId: 47, areaId: 1001 })
  })
})
