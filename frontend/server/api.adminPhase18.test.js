// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { validateBooking, validateCourierSettings } from './adminPhase18Api.js'
import { bookingDefaults, courierSettings, shipmentPhase18 } from './shop/adminPhase18.js'

/*
 * Phase 18 admin routes and fields (adminPhase18Api.js, shop/adminPhase18.js):
 * couriers and their settings, Pathao's places, booking a courier from an
 * order (one or many), syncing a parcel's status, and the courier fields of
 * shipments and grid rows. Laravel is faked; shapes from
 * docs/backend/PHASE18_CONTRACT.md §1 "Endpoints". No courier is ever called.
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

const API_COURIER = {
  key: 'steadfast',
  label: 'Steadfast',
  consignment_id: '1424107',
  tracking_code: '15BAEB8A',
  booked_via_api: true,
  courier_status: 'in_review',
  delivery_status: 'booked',
  delivery_status_label: 'Booked',
  cod_amount: '1000.00',
  courier_fee: '60.00',
  collected: null,
  status_updated_at: '2026-11-25T10:00:00Z',
  last_synced_at: '2026-11-25T10:05:00Z',
  api_key: 'never-sent',
}
const API_SHIPMENT = {
  number: 'SHP-100001',
  order_number: 'BN-100001',
  carrier: 'steadfast',
  carrier_label: 'Steadfast',
  tracking_number: '15BAEB8A',
  tracking_url: 'https://steadfast.com.bd/t/15BAEB8A',
  created_at: '2026-11-25T10:00:00Z',
  courier: API_COURIER,
  events: [{ delivery_status: 'booked', label: 'Booked', courier_status: 'in_review', message: null, source: 'booking', occurred_at: '2026-11-25T10:00:00Z' }],
}

describe('couriers and their settings', () => {
  it('lists the couriers without secrets, with the balance only when asked', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/couriers': {
        body: {
          data: [
            { key: 'steadfast', label: 'Steadfast', configured: true, mode: null, balance: '৳ 1,250.00', webhook_url: 'https://api.example/api/v1/couriers/steadfast/webhook', secret_key: 'x' },
            { key: 'pathao', label: 'Pathao', configured: false, mode: 'sandbox', balance: null, webhook_url: 'https://api.example/api/v1/couriers/pathao/webhook' },
          ],
          settings: { courier_default: 'steadfast', courier_auto_sync: false, courier_note_template: 'Handle with care', courier_pathao_item_type: 'document', courier_pathao_delivery_type: 'on_demand' },
        },
      },
    })
    const body = await (await admin('couriers?balance=1')).json()
    expect(toApi(calls)[0].search).toBe('?balance=1')
    expect(body.couriers[0]).toEqual({ key: 'steadfast', label: 'Steadfast', configured: true, mode: null, balance: '৳ 1,250.00', webhookUrl: 'https://api.example/api/v1/couriers/steadfast/webhook' })
    expect(body.couriers[1]).toMatchObject({ key: 'pathao', configured: false, mode: 'sandbox' })
    expect(JSON.stringify(body)).not.toContain('secret')
    expect(body.settings).toEqual({ defaultCourier: 'steadfast', autoSync: false, noteTemplate: 'Handle with care', pathaoItemType: 'document', pathaoDeliveryType: 'on_demand' })
    await admin('couriers')
    expect(toApi(calls)[1].search).toBe('')
  })

  it('saves the settings under the API’s names and checks them first', async () => {
    const calls = fakeLaravel({ 'PUT /api/admin/v1/couriers/settings': (entry) => ({ body: { data: sent(entry) } }) })
    const response = await admin('couriers/settings', { method: 'PUT', body: { defaultCourier: 'pathao', autoSync: true, noteTemplate: '  Fragile ', pathaoItemType: 'parcel', pathaoDeliveryType: 'normal' } })
    expect(response.status).toBe(200)
    expect(sent(toApi(calls)[0])).toEqual({ courier_default: 'pathao', courier_auto_sync: true, courier_note_template: 'Fragile', courier_pathao_item_type: 'parcel', courier_pathao_delivery_type: 'normal' })
    expect((await response.json()).settings).toMatchObject({ defaultCourier: 'pathao', noteTemplate: 'Fragile' })

    const bad = await admin('couriers/settings', { method: 'PUT', body: { defaultCourier: 'redx', noteTemplate: 'x'.repeat(201) } })
    expect(bad.status).toBe(422)
    expect(Object.keys((await bad.json()).errors)).toEqual(['defaultCourier', 'noteTemplate'])
    expect(toApi(calls)).toHaveLength(1)
    expect(validateCourierSettings({}).errors).toBeDefined()
    expect(validateCourierSettings({ defaultCourier: '' }).values).toEqual({ defaultCourier: null })
  })

  it('passes the API’s permission refusal on', async () => {
    fakeLaravel({ 'PUT /api/admin/v1/couriers/settings': { status: 403, body: { message: 'No.', code: 'permission_denied', permission: 'settings.edit' } } })
    const response = await admin('couriers/settings', { method: 'PUT', body: { autoSync: false } })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ message: 'No.', code: 'permission_denied', permission: 'settings.edit' })
  })

  it('reads settings with short names and falls back to the defaults', () => {
    expect(courierSettings({ default: 'pathao', auto_sync: true })).toEqual({ defaultCourier: 'pathao', autoSync: true, noteTemplate: null, pathaoItemType: 'parcel', pathaoDeliveryType: 'normal' })
    expect(courierSettings(null)).toMatchObject({ defaultCourier: null, autoSync: true })
  })
})

describe('Pathao places', () => {
  it('lists cities, a city’s zones and a zone’s areas; anything else is not found', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/couriers/pathao/cities': { body: { data: [{ id: 1, name: 'Dhaka' }, { city_id: 2, city_name: 'Chattogram' }] } },
      'GET /api/admin/v1/couriers/pathao/cities/1/zones': { body: { data: [{ id: 298, name: 'Mirpur 10' }] } },
      'GET /api/admin/v1/couriers/pathao/zones/298/areas': { body: { data: [{ id: 37, name: 'Senpara', home_delivery_available: true, pickup_available: false }] } },
    })
    expect((await (await admin('couriers/pathao/cities')).json()).options).toEqual([{ id: 1, name: 'Dhaka' }, { id: 2, name: 'Chattogram' }])
    expect((await (await admin('couriers/pathao/cities/1/zones')).json()).options).toEqual([{ id: 298, name: 'Mirpur 10' }])
    expect((await (await admin('couriers/pathao/zones/298/areas')).json()).options).toEqual([{ id: 37, name: 'Senpara', homeDelivery: true, pickup: false }])
    expect(toApi(calls)).toHaveLength(3)
    expect((await admin('couriers/pathao/cities/x/zones')).status).toBe(404)
    expect((await admin('couriers/pathao/stores')).status).toBe(404)
    expect((await admin('couriers/redx')).status).toBe(404)
    expect(toApi(calls)).toHaveLength(3)
  })

  it('passes "not set up" (422) and "can’t reach Pathao" (502) on with their message', async () => {
    fakeLaravel({
      'GET /api/admin/v1/couriers/pathao/cities': { status: 422, body: { message: 'Set up Pathao first (Settings → Couriers).', errors: { courier: ['Set up Pathao first (Settings → Couriers).'] } } },
      'GET /api/admin/v1/couriers/pathao/cities/1/zones': { status: 502, body: { message: 'Pathao could not be reached.' } },
    })
    const notSetUp = await admin('couriers/pathao/cities')
    expect(notSetUp.status).toBe(422)
    expect((await notSetUp.json()).errors.courier).toEqual(['Set up Pathao first (Settings → Couriers).'])
    const down = await admin('couriers/pathao/cities/1/zones')
    expect(down.status).toBe(502)
    expect((await down.json()).message).toBe('Pathao could not be reached.')
  })
})

describe('booking a courier', () => {
  it('reads the dialog’s defaults', async () => {
    fakeLaravel({
      'GET /api/admin/v1/orders/BN-100001/courier-booking': {
        body: {
          data: {
            courier_default: 'pathao',
            couriers: [{ key: 'steadfast', label: 'Steadfast', configured: true }, { key: 'pathao', label: 'Pathao', mode: 'sandbox' }],
            cod_amount: '1000.00',
            weight_kg: 0.75,
            note: 'Handle with care',
            phone: '01712345678',
            address_line: 'House 4, Road 2, Mirpur, Dhaka',
            pathao_match: { city_id: 1, zone_id: null },
            problem: 'Couriers collect taka: switch the store currency to taka first.',
            awaits_confirmation: false,
          },
        },
      },
    })
    const body = await (await admin('orders/BN-100001/courier-booking')).json()
    expect(body.booking).toEqual({
      defaultCourier: 'pathao',
      couriers: [{ key: 'steadfast', label: 'Steadfast', mode: null }, { key: 'pathao', label: 'Pathao', mode: 'sandbox' }],
      codAmount: 1000,
      weightKg: 0.75,
      note: 'Handle with care',
      phone: '01712345678',
      addressLine: 'House 4, Road 2, Mirpur, Dhaka',
      pathaoMatch: { cityId: 1, zoneId: null, areaId: null },
      problem: 'Couriers collect taka: switch the store currency to taka first.',
      awaitsConfirmation: false,
    })
    expect(bookingDefaults({ couriers: ['steadfast', 'redx'] }).couriers).toEqual([{ key: 'steadfast', label: null, mode: null }])
  })

  it('books Pathao with the places and options, and answers 201 with the shipment', async () => {
    const calls = fakeLaravel({ 'POST /api/admin/v1/orders/BN-100001/courier-booking': { status: 201, body: { data: { ...API_SHIPMENT, carrier: 'pathao' } } } })
    const response = await admin('orders/BN-100001/courier-booking', {
      method: 'POST',
      body: { courier: 'pathao', codAmount: 1000, weightKg: 0.5, note: ' Fragile ', notifyCustomer: true, confirmationOverride: 'Customer called back', pathao: { cityId: 1, zoneId: 298, areaId: 37, deliveryType: 'normal', itemType: 'parcel' } },
    })
    expect(response.status).toBe(201)
    const call = toApi(calls)[0]
    expect(call.headers.Authorization).toBe('Bearer 9|ADMIN')
    expect(sent(call)).toEqual({
      courier: 'pathao',
      cod_amount: 1000,
      weight_kg: 0.5,
      note: 'Fragile',
      notify_customer: true,
      confirmation_override: 'Customer called back',
      pathao: { city_id: 1, zone_id: 298, area_id: 37, delivery_type: 'normal', item_type: 'parcel' },
    })
    const { shipment } = await response.json()
    expect(shipment).toMatchObject({ number: 'SHP-100001', orderNumber: 'BN-100001', trackingNumber: '15BAEB8A' })
    expect(shipment.courier).toMatchObject({ key: 'steadfast', consignmentId: '1424107', deliveryStatus: 'booked', codAmount: 1000, courierFee: 60, collected: null })
    expect(shipment.courier.apiKey).toBeUndefined()
    expect(shipment.events).toEqual([{ deliveryStatus: 'booked', label: 'Booked', courierStatus: 'in_review', message: null, source: 'booking', occurredAt: '2026-11-25T10:00:00Z' }])
  })

  it('checks the booking before calling the API', async () => {
    const calls = fakeLaravel({})
    const response = await admin('orders/BN-100001/courier-booking', { method: 'POST', body: { courier: 'pathao', codAmount: -1, weightKg: 0, confirmationOverride: 'x', pathao: { cityId: 'Dhaka' } } })
    expect(response.status).toBe(422)
    expect(Object.keys((await response.json()).errors).sort()).toEqual(['codAmount', 'confirmationOverride', 'pathaoCityId', 'pathaoZoneId', 'weightKg'])
    expect(toApi(calls)).toHaveLength(0)
    expect(validateBooking({ courier: 'steadfast' }).values).toEqual({ courier: 'steadfast' })
    expect(validateBooking({ courier: 'redx' }).errors.courier).toBeDefined()
  })

  it('shows the courier’s refusal on the field the admin sees', async () => {
    fakeLaravel({
      'POST /api/admin/v1/orders/BN-100001/courier-booking': {
        status: 422,
        body: { message: 'Steadfast: The invoice field must be unique.', errors: { courier: ['Steadfast: The invoice field must be unique.'], 'pathao.zone_id': ['Choose the zone.'], cod_amount: ['Too much.'] } },
      },
    })
    const response = await admin('orders/BN-100001/courier-booking', { method: 'POST', body: { courier: 'steadfast' } })
    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual({ courier: ['Steadfast: The invoice field must be unique.'], pathaoZoneId: ['Choose the zone.'], codAmount: ['Too much.'] })
  })

  it('books several orders with Steadfast only, reporting each one', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/orders/courier-bookings': {
        body: { data: { booked: [{ number: 'BN-100001', consignment_id: '1424107', tracking_code: '15BAEB8A' }], failed: [{ number: 'BN-100002', message: 'A courier needs the customer’s Bangladeshi mobile number.' }] } },
      },
    })
    const response = await admin('orders/courier-bookings', { method: 'POST', body: { courier: 'steadfast', numbers: ['BN-100001', 'BN-100002'] } })
    expect(await response.json()).toEqual({
      booked: [{ number: 'BN-100001', consignmentId: '1424107', trackingCode: '15BAEB8A' }],
      failed: [{ number: 'BN-100002', message: 'A courier needs the customer’s Bangladeshi mobile number.' }],
      live: true,
    })
    expect(sent(toApi(calls)[0])).toEqual({ courier: 'steadfast', numbers: ['BN-100001', 'BN-100002'] })
    expect((await admin('orders/courier-bookings', { method: 'POST', body: { courier: 'pathao', numbers: ['BN-100001'] } })).status).toBe(422)
    const many = Array.from({ length: 51 }, (_, index) => `BN-${100001 + index}`)
    expect((await admin('orders/courier-bookings', { method: 'POST', body: { courier: 'steadfast', numbers: many } })).status).toBe(422)
    expect((await admin('orders/courier-bookings', { method: 'POST', body: { courier: 'steadfast', numbers: ['BN-1', 'BN-1'] } })).status).toBe(422)
    expect(toApi(calls)).toHaveLength(1)
  })

  it('asks the courier for a shipment’s status', async () => {
    const calls = fakeLaravel({ 'POST /api/admin/v1/shipments/SHP-100001/sync': { body: { data: { ...API_SHIPMENT, courier: { ...API_COURIER, delivery_status: 'delivered', delivery_status_label: 'Delivered', collected: '1000.00' } } } } })
    const { shipment } = await (await admin('shipments/SHP-100001/sync', { method: 'POST', body: {} })).json()
    expect(shipment.courier).toMatchObject({ deliveryStatus: 'delivered', collected: 1000 })
    expect(shipment.deliveryStatus).toBe('delivered')
    expect(toApi(calls)[0].method).toBe('POST')
    expect((await admin('shipments/SHP-1/refresh', { method: 'POST', body: {} })).status).toBe(404)
  })

  it('needs the BuyNest backend', async () => {
    vi.stubEnv('VITE_API_PROVIDER', 'dummyjson')
    fakeLaravel({})
    expect((await admin('couriers')).status).toBe(404)
  })
})

describe('shipments and the order grid', () => {
  it('order detail shipments carry the courier and events; manual ones stay as they were', async () => {
    fakeLaravel({
      'GET /api/admin/v1/orders/BN-100001': {
        body: {
          data: {
            number: 'BN-100001',
            status: 'shipped',
            items: [],
            totals: {},
            history: [],
            shipments: [API_SHIPMENT, { number: 'SHP-100002', carrier: 'dhl', carrier_label: 'DHL', tracking_number: null, created_at: '2026-11-25T10:00:00Z' }],
          },
        },
      },
    })
    const order = await (await admin('orders/BN-100001')).json()
    expect(order.shipments[0].courier).toMatchObject({ label: 'Steadfast', trackingCode: '15BAEB8A', deliveryStatusLabel: 'Booked' })
    expect(order.shipments[0].events).toHaveLength(1)
    expect(order.shipments[1]).not.toHaveProperty('courier')
    expect(order.shipments[1]).not.toHaveProperty('events')
    // The real API: a manual shipment has courier null and "shipped"; the staff events keep their raw status and source.
    fakeLaravel({
      'GET /api/admin/v1/orders/BN-100001': {
        body: { data: { number: 'BN-100001', status: 'shipped', items: [], totals: {}, history: [], shipments: [{ number: 'SHP-100003', carrier: 'redx', carrier_label: 'RedX', tracking_number: 'RX1', created_at: '2026-11-25T10:00:00Z', delivery_status: 'shipped', delivery_status_label: 'Shipped', courier: null, events: [] }, { ...API_SHIPMENT, delivery_status: 'booked', delivery_status_label: 'Booked' }] } },
      },
    })
    const real = await (await admin('orders/BN-100001')).json()
    expect(real.shipments[0]).toMatchObject({ courier: null, deliveryStatus: 'shipped', events: [] })
    expect(real.shipments[1].events[0]).toEqual({ deliveryStatus: 'booked', label: 'Booked', courierStatus: 'in_review', message: null, source: 'booking', occurredAt: '2026-11-25T10:00:00Z' })
    expect(shipmentPhase18({ courier: null, delivery_status: 'shipped', events: [] })).toEqual({ courier: null, deliveryStatus: 'shipped', deliveryStatusLabel: null, events: [] })
  })

  it('the Shipments list maps the courier fields, and filters by the new carriers', async () => {
    const calls = fakeLaravel({ 'GET /api/admin/v1/shipments': { body: { data: [API_SHIPMENT], meta: { total: 1 } } } })
    const body = await (await admin('shipments?carrier=pathao')).json()
    expect(body.shipments[0]).toMatchObject({ number: 'SHP-100001', deliveryStatus: 'booked', courier: { consignmentId: '1424107' } })
    expect(new URLSearchParams(toApi(calls)[0].search).get('carrier')).toBe('pathao')
  })

  it('the order grid filters by delivery status and shows each row’s', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/orders': { body: { data: [{ number: 'BN-100001', status: 'shipped', totals: {}, delivery_status: 'on_hold', delivery_status_label: 'On hold' }, { number: 'BN-100002', status: 'processing', totals: {} }], meta: { total: 2 } } },
    })
    const body = await (await admin('orders?delivery=on_hold')).json()
    expect(new URLSearchParams(toApi(calls)[0].search).get('delivery_status')).toBe('on_hold')
    expect(body.orders[0]).toMatchObject({ deliveryStatus: 'on_hold', deliveryStatusLabel: 'On hold' })
    expect(body.orders[1]).not.toHaveProperty('deliveryStatus')
    await admin('orders?delivery=lost')
    expect(new URLSearchParams(toApi(calls)[1].search).has('delivery_status')).toBe(false)
  })

  it('a manual shipment may use the new carriers', async () => {
    const calls = fakeLaravel({ 'POST /api/admin/v1/orders/BN-100001/shipments': { status: 201, body: { data: { number: 'SHP-100003', carrier: 'redx', carrier_label: 'RedX', tracking_number: 'RX1', created_at: '2026-11-25T10:00:00Z' } } } })
    const response = await admin('orders/BN-100001/shipments', { method: 'POST', body: { carrier: 'redx', trackingNumber: 'RX1' } })
    expect(response.status).toBe(201)
    expect(sent(toApi(calls)[0]).carrier).toBe('redx')
  })
})
