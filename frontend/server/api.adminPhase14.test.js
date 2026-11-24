// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { bdMobile, validateZone } from './adminPhase14Api.js'
import { deliveryZone, orderPhase14, toZoneBody } from './shop/adminPhase14.js'

/*
 * Phase 14 admin routes and fields (adminPhase14Api.js, shop/adminPhase14.js):
 * Bangladesh places, delivery zones, zone rates, COD settings, Bangladesh
 * addresses in the address book and admin-created orders, the order's zone
 * and COD amounts, the To confirm queue, collection on delivery, the
 * shipping override, packing slip PDFs and the courier CSV. Laravel is
 * faked; shapes from docs/backend/PHASE14_CONTRACT.md's implementation notes.
 */

const SITE = 'https://shop.example'
const ME = { id: 1, name: 'Store Owner', email: 'admin@buynest.test', role: { id: 1, name: 'Owner' }, permissions: [] }

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const entry = { method: init.method ?? 'GET', path: pathname, search, body: init.body, headers: init.headers }
    calls.push(entry)
    const key = `${entry.method} ${pathname}`
    const found = key === 'GET /api/admin/v1/me' ? { body: { data: ME } } : routes[key]
    const route = typeof found === 'function' ? found(entry) : (found ?? { status: 404, body: { message: 'Not found' } })
    if (route.raw !== undefined) return new Response(route.raw, { status: route.status ?? 200, headers: { 'Content-Type': route.type, 'Content-Disposition': route.disposition ?? '' } })
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
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

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const API_ZONE = {
  id: 2,
  code: 'dhaka_suburbs',
  name: 'Dhaka suburbs',
  bn_name: 'ঢাকার আশপাশ',
  position: 1,
  is_active: true,
  is_fallback: false,
  districts: [{ id: 41, name: 'Gazipur', bn_name: 'গাজীপুর' }],
  areas: [{ id: 1003, name: 'Mirpur', bn_name: 'মিরপুর', district_id: 47, district_name: 'Dhaka' }],
  rates_count: 2,
}

describe('places', () => {
  it('lists divisions, districts and areas in English, and needs a district for areas', async () => {
    const calls = fakeLaravel({
      'GET /api/v1/places/bd/districts': { body: { data: [{ id: 47, division_id: 3, name: 'ঢাকা', name_en: 'Dhaka', name_bn: 'ঢাকা' }] } },
      'GET /api/v1/places/bd/areas': { body: { data: [{ id: 1003, district_id: 47, name: 'Mirpur', name_en: 'Mirpur', name_bn: 'মিরপুর', kind: 'thana', city_corporation: 'Dhaka North', postcodes: ['1216', 'x'] }] } },
    })
    expect(await (await admin('places/bd/districts?division=3')).json()).toEqual({ places: [{ id: 47, name: 'Dhaka', nameBn: 'ঢাকা', divisionId: 3 }], live: true })
    expect(toApi(calls)[0].search).toBe('?division=3')
    const areas = await (await admin('places/bd/areas?district=47')).json()
    expect(areas.places[0]).toEqual({ id: 1003, name: 'Mirpur', nameBn: 'মিরপুর', districtId: 47, kind: 'thana', cityCorporation: 'Dhaka North', postcodes: ['1216'] })
    expect((await admin('places/bd/areas')).status).toBe(422)
    expect((await admin('places/bd/upazilas')).status).toBe(404)
  })
})

describe('delivery zones', () => {
  it('maps zones both ways, and checks them first', async () => {
    expect(deliveryZone(API_ZONE)).toEqual({
      id: 2,
      code: 'dhaka_suburbs',
      name: 'Dhaka suburbs',
      nameBn: 'ঢাকার আশপাশ',
      position: 1,
      isActive: true,
      isFallback: false,
      places: [
        { districtId: 41, areaId: null, name: 'Gazipur' },
        { areaId: 1003, districtId: null, name: 'Mirpur', districtName: 'Dhaka' },
      ],
      rateCount: 2,
    })
    expect(toZoneBody({ name: 'X', nameBn: null, isActive: false, places: [{ districtId: 41 }, { areaId: 1003 }] })).toEqual({ name: 'X', bn_name: null, is_active: false, district_ids: [41], area_ids: [1003] })
    expect(validateZone({ code: 'Bad Code', name: '' }, { partial: false }).errors).toMatchObject({ code: expect.any(Array), name: expect.any(Array) })
    expect(validateZone({ places: [{ districtId: 1, areaId: 2 }] }, { partial: true }).errors.places).toBeDefined()

    const calls = fakeLaravel({
      'GET /api/admin/v1/delivery-zones': { body: { data: [API_ZONE] } },
      'POST /api/admin/v1/delivery-zones': { status: 201, body: { data: { ...API_ZONE, id: 4, code: 'chattogram_city' } } },
      'PATCH /api/admin/v1/delivery-zones/2': { status: 422, body: { message: 'Taken', errors: { 'area_ids.0': ['Mirpur is already in zone Inside Dhaka.'] } } },
    })
    expect((await (await admin('delivery-zones')).json()).zones[0].code).toBe('dhaka_suburbs')
    const created = await admin('delivery-zones', { method: 'POST', body: { code: 'chattogram_city', name: 'Chattogram city', places: [{ districtId: 12 }] } })
    expect(created.status).toBe(201)
    expect(sent(toApi(calls).at(-1))).toEqual({ code: 'chattogram_city', name: 'Chattogram city', district_ids: [12], area_ids: [] })
    const refused = await admin('delivery-zones/2', { method: 'PATCH', body: { places: [{ areaId: 1003 }] } })
    expect(refused.status).toBe(422)
    expect((await refused.json()).errors).toEqual({ places: ['Mirpur is already in zone Inside Dhaka.'] })
  })

  it('reorders by saving each moved zone\'s position', async () => {
    const zones = [
      { ...API_ZONE, id: 1, code: 'inside_dhaka', position: 0 },
      { ...API_ZONE, id: 2, position: 1 },
    ]
    const calls = fakeLaravel({
      'GET /api/admin/v1/delivery-zones': { body: { data: zones } },
      'PATCH /api/admin/v1/delivery-zones/1': { body: { data: zones[0] } },
      'PATCH /api/admin/v1/delivery-zones/2': { body: { data: zones[1] } },
    })
    const response = await admin('delivery-zones/reorder', { method: 'POST', body: { ids: [2, 1] } })
    expect(response.status).toBe(200)
    const patches = toApi(calls).filter((entry) => entry.method === 'PATCH')
    expect(patches.map((entry) => [entry.path, sent(entry)])).toEqual([
      ['/api/admin/v1/delivery-zones/2', { position: 0 }],
      ['/api/admin/v1/delivery-zones/1', { position: 1 }],
    ])
    expect((await admin('delivery-zones/reorder', { method: 'POST', body: { ids: [2] } })).status).toBe(422)
  })
})

describe('zone rates and settings', () => {
  it('sends and reads a rate row\'s zone and delivery time', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/shipping-rates': { status: 201, body: { data: { id: 9, method: 'standard', country: 'Bangladesh', min_weight_grams: 0, max_weight_grams: null, min_subtotal: '0.00', max_subtotal: null, price: '60.00', position: 0, zone_code: 'inside_dhaka', eta_days_min: 1, eta_days_max: 2 } } },
    })
    const response = await admin('shipping-rates', { method: 'POST', body: { method: 'standard', country: 'Bangladesh', minWeightGrams: 0, maxWeightGrams: null, minSubtotal: 0, maxSubtotal: null, price: 60, zoneCode: 'inside_dhaka', etaDaysMin: 1, etaDaysMax: 2 } })
    expect(response.status).toBe(201)
    expect(sent(toApi(calls)[0])).toMatchObject({ price: '60.00', zone_code: 'inside_dhaka', eta_days_min: 1, eta_days_max: 2 })
    expect((await response.json()).rate).toMatchObject({ zoneCode: 'inside_dhaka', etaDaysMin: 1, etaDaysMax: 2 })
    const bad = await admin('shipping-rates', { method: 'POST', body: { method: 'standard', country: '*', minWeightGrams: 0, minSubtotal: 0, price: 1, etaDaysMin: 3, etaDaysMax: 1 } })
    expect((await bad.json()).errors.etaDaysMax).toBeDefined()
  })

  it('reads and saves Settings → Cash on delivery and the default country', async () => {
    const settings = {
      checkout: { allowed_countries: ['Bangladesh'], guest_checkout: true, enabled_payment_methods: ['cod'], default_country: 'Bangladesh' },
      cod: { max_order_total: '20000.00', fee: '0.00', advance: 'none', zones: ['inside_dhaka'], require_confirmation: true },
    }
    const calls = fakeLaravel({
      'GET /api/admin/v1/settings': { body: { data: settings } },
      'PATCH /api/admin/v1/settings': { status: 422, body: { message: 'Needs SSLCommerz', errors: { 'cod.advance': ['Advance delivery charge needs SSLCommerz.'] } } },
    })
    const read = await (await admin('settings')).json()
    expect(read.cod).toEqual({ maxOrderTotal: 20000, fee: 0, advance: 'none', zones: ['inside_dhaka'], requireConfirmation: true })
    expect(read.checkout.defaultCountry).toBe('Bangladesh')
    const refused = await admin('settings', { method: 'PATCH', body: { cod: { maxOrderTotal: null, fee: 20, advance: 'delivery_charge', zones: [], requireConfirmation: true }, checkout: { defaultCountry: '' } } })
    expect(sent(toApi(calls).at(-1))).toEqual({ cod: { max_order_total: null, fee: '20.00', advance: 'delivery_charge', zones: [], require_confirmation: true }, checkout: { default_country: null } })
    expect((await refused.json()).errors).toEqual({ 'cod.advance': ['Advance delivery charge needs SSLCommerz.'] })
    expect((await admin('settings', { method: 'PATCH', body: { cod: { advance: 'everything' } } })).status).toBe(422)
  })
})

describe('Bangladesh addresses', () => {
  it('the address book takes the place ids, an optional postcode and a Bangladeshi mobile', async () => {
    expect(bdMobile('01712-345678')).toBe('+8801712345678')
    expect(bdMobile('+880 1912 345678')).toBe('+8801912345678')
    expect(bdMobile('01212345678')).toBeNull()
    const calls = fakeLaravel({ 'POST /api/admin/v1/customers/5/addresses': { status: 201, body: { data: { id: 3, first_name: 'Nadia', last_name: 'Rahman', line1: 'House 4', city: 'Dhaka', state: 'Dhaka', country: 'Bangladesh', postal_code: null, phone: '+8801712345678', division_id: 3, district_id: 47, area_id: 1003 } } } })
    const address = { firstName: 'Nadia', lastName: 'Rahman', line1: 'House 4', line2: null, postalCode: null, country: 'Bangladesh', divisionId: 3, districtId: 47, areaId: 1003, phone: '01712 345678', isDefaultShipping: true, isDefaultBilling: true }
    const response = await admin('customers/5/addresses', { method: 'POST', body: address })
    expect(response.status).toBe(201)
    const body = sent(toApi(calls)[0])
    expect(body).toMatchObject({ division_id: 3, district_id: 47, area_id: 1003, phone: '+8801712345678', postal_code: null, country: 'Bangladesh' })
    expect(body.city).toBeUndefined()
    expect((await response.json()).address).toMatchObject({ divisionId: 3, districtId: 47, areaId: 1003 })

    const bad = await admin('customers/5/addresses', { method: 'POST', body: { ...address, areaId: null, postalCode: '12', phone: '12345' } })
    expect((await bad.json()).errors).toMatchObject({ areaId: expect.any(Array), postalCode: expect.any(Array), phone: ['Enter a Bangladeshi mobile number, for example 01712 345678.'] })
    // Other countries keep the old rules.
    const other = await admin('customers/5/addresses', { method: 'POST', body: { ...address, country: 'India', divisionId: undefined, districtId: undefined, areaId: undefined } })
    expect((await other.json()).errors).toMatchObject({ city: expect.any(Array), postalCode: expect.any(Array) })
  })

  it('an admin-created order and its quote send the places', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/orders/quote': { body: { data: { items: [], totals: { total: '100.00' }, delivery_zone: { code: 'inside_dhaka', name: 'Inside Dhaka' }, shipping_options: [{ id: 'standard', label: 'Standard', price: '60.00', eta: 'Delivery in 1–2 days', eta_days_min: 1, eta_days_max: 2, zone_code: 'inside_dhaka' }] } } },
      'POST /api/admin/v1/orders': { status: 201, body: { data: { number: 'BN-100001', status: 'processing', totals: {}, items: [] } } },
    })
    const shippingAddress = { firstName: 'Nadia', lastName: 'Rahman', line1: 'House 4', line2: null, postalCode: null, country: 'Bangladesh', divisionId: 3, districtId: 47, areaId: 1003 }
    const order = { customerId: 5, items: [{ productId: 1, quantity: 1 }], shippingAddress, sameAsShipping: true, shippingMethod: 'standard', paymentMethod: 'cod' }
    const quote = await (await admin('orders/quote', { method: 'POST', body: order })).json()
    expect(sent(toApi(calls)[0]).shipping_address).toEqual({ country: 'Bangladesh', division_id: 3, district_id: 47, area_id: 1003 })
    expect(quote.deliveryZone).toMatchObject({ code: 'inside_dhaka', name: 'Inside Dhaka' })
    expect(quote.shippingOptions[0]).toMatchObject({ etaDaysMin: 1, etaDaysMax: 2 })
    expect((await admin('orders', { method: 'POST', body: order })).status).toBe(201)
    expect(sent(toApi(calls)[1]).shipping_address).toMatchObject({ division_id: 3, district_id: 47, area_id: 1003, line1: 'House 4', postal_code: null })
  })
})

const API_ORDER = {
  number: 'BN-100001',
  status: 'processing',
  payment_status: 'partially_paid',
  payment_method: 'cod',
  email: 'nadia@example.com',
  phone: '+8801712345678',
  totals: { subtotal: '1000.00', shipping: '60.00', total: '1080.00', cod_fee: '20.00' },
  items: [],
  shipping_address: { first_name: 'Nadia', last_name: 'Rahman', line1: 'House 4', city: 'Dhaka', state: 'Dhaka', country: 'Bangladesh', division_id: 3, district_id: 47, area_id: 1003, area: 'Mirpur' },
  delivery: { zone_code: 'inside_dhaka', zone_name: 'Inside Dhaka', eta_days_min: 1, eta_days_max: 2, eta: 'Delivery in 1–2 days' },
  cod: { fee: '20.00', advance_amount: '80.00', advance_paid: '80.00', cod_due: '1000.00', collected: '0.00' },
  confirmation: { status: 'pending', attempts: 1, confirmed_at: null, logs: [{ id: 1, outcome: 'unreachable', note: 'No answer', admin_name: 'Sam', created_at: '2026-11-23T10:00:00Z' }] },
  confirmation_status: 'pending',
  history: [],
}

describe('orders', () => {
  it('the order page gets the zone, delivery time, COD amounts, confirmation log and the area name', async () => {
    expect(orderPhase14({})).toEqual({})
    fakeLaravel({ 'GET /api/admin/v1/orders/BN-100001': { body: { data: API_ORDER } } })
    const order = await (await admin('orders/BN-100001')).json()
    expect(order).toMatchObject({
      deliveryZone: { code: 'inside_dhaka', name: 'Inside Dhaka' },
      etaDaysMin: 1,
      etaDaysMax: 2,
      codFee: 20,
      advancePaid: 80,
      codDue: 1000,
      codCollection: null,
      confirmationStatus: 'pending',
      confirmation: { status: 'pending', attempts: 1, confirmedAt: null, log: [{ id: 1, outcome: 'unreachable', note: 'No answer', adminName: 'Sam', createdAt: '2026-11-23T10:00:00Z' }] },
    })
    expect(order.shippingAddress).toMatchObject({ divisionId: 3, districtId: 47, areaId: 1003, area: { name: 'Mirpur' } })
  })

  it('the grid passes the zone, COD and confirmation filters (and the CSV export too)', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/orders': { body: { data: [API_ORDER], meta: { total: 1 } } },
      'GET /api/admin/v1/orders/export.csv': { raw: 'number\n', type: 'text/csv' },
    })
    const list = await (await admin('orders?zone=inside_dhaka&cod=1&confirmation=pending&status=processing')).json()
    const search = new URLSearchParams(toApi(calls)[0].search)
    expect(Object.fromEntries(search)).toMatchObject({ delivery_zone: 'inside_dhaka', cod: '1', confirmation_status: 'pending', status: 'processing' })
    expect(list.orders[0]).toMatchObject({ deliveryZone: { code: 'inside_dhaka' }, codDue: 1000, confirmationStatus: 'pending' })
    await admin('orders/export.csv?zone=bad zone&confirmation=nope&cod=1')
    expect(Object.fromEntries(new URLSearchParams(toApi(calls)[1].search))).toEqual({ cod: '1' })
  })

  it('the To confirm queue and a call\'s outcome', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/orders/to-confirm': {
        body: {
          data: [{ number: 'BN-100001', placed_at: '2026-11-23T09:00:00Z', status: 'processing', payment_status: 'unpaid', currency: 'BDT', grand_total: '1080.00', cod_due: '1080.00', advance_paid: '0.00', customer_name: 'Nadia Rahman', phone: '+8801712345678', tel_url: 'tel:+8801712345678', email: 'n@example.com', address: 'House 4, Mirpur, Dhaka', delivery_zone: { code: 'inside_dhaka', name: 'Inside Dhaka' }, confirmation_status: 'unreachable', confirmation_attempts: 2, last_note: 'No answer', last_attempt_at: '2026-11-23T10:00:00Z', previous: { orders: 3, delivered: 2, cancelled: 1, returns: 0 } }],
          meta: { total: 1 },
        },
      },
      'POST /api/admin/v1/orders/BN-100001/confirmation': { body: { data: { ...API_ORDER, confirmation_status: 'confirmed', confirmation: { ...API_ORDER.confirmation, status: 'confirmed' } } } },
    })
    const queue = await (await admin('orders/to-confirm?limit=20&skip=20')).json()
    expect(toApi(calls)[0].search).toBe('?page=2&per_page=20')
    expect(queue).toMatchObject({ total: 1, orders: [{ number: 'BN-100001', total: 1080, codDue: 1080, customerName: 'Nadia Rahman', phone: '+8801712345678', address: 'House 4, Mirpur, Dhaka', confirmationStatus: 'unreachable', attempts: 2, lastNote: 'No answer', history: { orders: 3, delivered: 2, cancelled: 1, returns: 0 } }] })

    const confirmed = await (await admin('orders/BN-100001/confirmation', { method: 'POST', body: { outcome: 'confirmed', note: ' Spoke to her ', notifyCustomer: true } })).json()
    expect(sent(toApi(calls)[1])).toEqual({ outcome: 'confirmed', note: 'Spoke to her', notify_customer: true })
    expect(confirmed.order.confirmation.status).toBe('confirmed')
    const noReason = await admin('orders/BN-100001/confirmation', { method: 'POST', body: { outcome: 'cancelled' } })
    expect((await noReason.json()).errors.reason).toBeDefined()
  })

  it('collection on delivery and the shipping override', async () => {
    const calls = fakeLaravel({
      'PATCH /api/admin/v1/orders/BN-100001': { body: { data: { ...API_ORDER, status: 'delivered' } } },
      'POST /api/admin/v1/orders/BN-100001/shipments': { status: 422, body: { message: 'Not confirmed', errors: { confirmation_override: ['Too short.'] } } },
    })
    await admin('orders/BN-100001', { method: 'PATCH', body: { status: 'delivered', collectedAmount: 900, collectionNote: ' Customer paid less ', notifyCustomer: false } })
    expect(sent(toApi(calls)[0])).toEqual({ status: 'delivered', notify_customer: false, collected_amount: '900.00', collection_note: 'Customer paid less' })
    const shipped = await admin('orders/BN-100001/shipments', { method: 'POST', body: { carrier: 'other', confirmationOverride: 'Customer asked by SMS' } })
    expect(sent(toApi(calls)[1])).toMatchObject({ carrier: 'other', confirmation_override: 'Customer asked by SMS' })
    expect((await shipped.json()).errors).toEqual({ confirmationOverride: ['Too short.'] })
    expect((await admin('orders/BN-100001', { method: 'PATCH', body: { collectedAmount: -1 } })).status).toBe(422)
    expect((await admin('orders/BN-100001/shipments', { method: 'POST', body: { carrier: 'other', confirmationOverride: 'x' } })).status).toBe(422)
  })

  it('packing slip PDFs and the courier CSV (with its byte order mark)', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/orders/BN-100001/packing-slip.pdf': { raw: '%PDF-1.7 one', type: 'application/pdf', disposition: 'attachment; filename="packing-slip-BN-100001.pdf"' },
      'POST /api/admin/v1/orders/packing-slips': { raw: '%PDF-1.7 many', type: 'application/pdf' },
      'GET /api/admin/v1/orders/export/courier.csv': { raw: 'invoice,recipient_name\nBN-100001,নাদিয়া\n', type: 'text/csv; charset=utf-8', disposition: 'attachment; filename="courier-2026-11-23.csv"' },
    })
    const one = await admin('orders/BN-100001/packing-slip.pdf')
    expect(one.headers.get('content-type')).toBe('application/pdf')
    expect(one.headers.get('content-disposition')).toBe('attachment; filename="packing-slip-BN-100001.pdf"')
    expect(await one.text()).toBe('%PDF-1.7 one')

    const many = await admin('orders/packing-slips', { method: 'POST', body: { numbers: ['BN-100001', 'BN-100002'] } })
    expect(many.headers.get('content-disposition')).toBe('attachment; filename="packing-slips.pdf"')
    expect(sent(toApi(calls)[1])).toEqual({ numbers: ['BN-100001', 'BN-100002'] })
    expect((await admin('orders/packing-slips', { method: 'POST', body: { numbers: [] } })).status).toBe(422)

    const csv = await admin('orders/export/courier.csv?numbers=BN-100001,bn-100002')
    expect(toApi(calls)[2].search).toBe(`?${new URLSearchParams({ numbers: 'BN-100001,BN-100002' })}`)
    expect(csv.headers.get('content-disposition')).toBe('attachment; filename="courier-2026-11-23.csv"')
    const bytes = new Uint8Array(await csv.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes)).toContain('নাদিয়া')
    expect((await admin('orders/export/courier.csv?numbers=nope')).status).toBe(422)
  })

  it('in demo mode the routes say they need the backend', async () => {
    vi.stubEnv('VITE_API_PROVIDER', 'dummyjson')
    fakeLaravel({})
    expect((await admin('delivery-zones')).status).toBe(404)
  })
})
