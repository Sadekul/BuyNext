// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

/*
 * Phase 6 storefront services: the address book, returns, group pricing,
 * and "save this address" at checkout (/api/shop, /api/auth/me).
 */

const SITE = 'https://shop.example'

/** Fakes the Laravel API: `routes` maps "METHOD /path" to { status, body }. Records each call. */
function fakeUpstream(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    calls.push({ path: pathname, search, init, body: init.body ? JSON.parse(init.body) : undefined })
    const route = routes[`${init.method ?? 'GET'} ${pathname}`] ?? { status: 404, body: { message: 'Not found' } }
    if (route.status === 204) return new Response(null, { status: 204 })
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

const request = (prefix) => (path, { method = 'GET', body, cookie } = {}) =>
  handleApiRequest(
    new Request(`${SITE}/api/${prefix}/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }) },
      body: body && JSON.stringify(body),
    }),
  )
const shop = request('shop')
const auth = request('auth')
const SIGNED_IN = 'buynest_at=AT'

beforeEach(() => vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test'))
afterEach(() => vi.unstubAllEnvs())

const API_ADDRESS = {
  id: 7, first_name: 'Nadia', last_name: 'Rahman', company: null, phone: '+8801712345678', line1: '12 Lake Road', line2: null,
  city: 'Dhaka', state: 'Dhaka', postal_code: '1212', country: 'Bangladesh', is_default_shipping: true, is_default_billing: false,
  created_at: '2026-11-16T10:00:00Z', updated_at: '2026-11-16T10:00:00Z', customer_id: 5,
}
const ADDRESS = {
  id: 7, firstName: 'Nadia', lastName: 'Rahman', phone: '+8801712345678', company: '', line1: '12 Lake Road', line2: '',
  city: 'Dhaka', state: 'Dhaka', postalCode: '1212', country: 'Bangladesh', isDefaultShipping: true, isDefaultBilling: false,
}

describe('address book (/api/shop/me/addresses)', () => {
  it('needs the customer session', async () => {
    const calls = fakeUpstream({})
    for (const [path, method] of [['me/addresses', 'GET'], ['me/addresses', 'POST'], ['me/addresses/7', 'PATCH'], ['me/addresses/7', 'DELETE']]) {
      expect((await shop(path, { method, body: method === 'GET' || method === 'DELETE' ? undefined : {} })).status).toBe(401)
    }
    expect(calls).toHaveLength(0)
  })

  it('lists the addresses in the storefront shape, without extra keys', async () => {
    const calls = fakeUpstream({ 'GET /api/v1/me/addresses': { body: { data: [API_ADDRESS] } } })
    const response = await shop('me/addresses', { cookie: SIGNED_IN })
    expect(await response.json()).toEqual({ addresses: [ADDRESS] })
    expect(calls[0].init.headers.Authorization).toBe('Bearer AT')
  })

  it('creates an address: only the listed fields go through, in snake_case', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/me/addresses': { status: 201, body: { data: API_ADDRESS } } })
    const response = await shop('me/addresses', {
      method: 'POST',
      cookie: SIGNED_IN,
      body: { ...ADDRESS, id: 99, company: '  ', line2: '', customerId: 1, isDefaultShipping: true },
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(ADDRESS)
    expect(calls[0].body).toEqual({
      first_name: 'Nadia', last_name: 'Rahman', phone: '+8801712345678', company: null, line1: '12 Lake Road', line2: null,
      city: 'Dhaka', state: 'Dhaka', postal_code: '1212', country: 'Bangladesh', is_default_shipping: true, is_default_billing: false,
    })
  })

  it('PATCH sends only what changed (a "make default" click is just the flag)', async () => {
    const calls = fakeUpstream({ 'PATCH /api/v1/me/addresses/7': { body: { data: { ...API_ADDRESS, is_default_billing: true } } } })
    const response = await shop('me/addresses/7', { method: 'PATCH', cookie: SIGNED_IN, body: { isDefaultBilling: true } })
    expect((await response.json()).isDefaultBilling).toBe(true)
    expect(calls[0].body).toEqual({ is_default_billing: true })
  })

  it("passes on 404 for someone else's address, and 422 field errors with the form's names", async () => {
    fakeUpstream({
      'DELETE /api/v1/me/addresses/8': { status: 404, body: { message: 'Not found.' } },
      'POST /api/v1/me/addresses': { status: 422, body: { message: 'Invalid', errors: { postal_code: ['The postal code is invalid.'], address: ['At most 20.'] } } },
    })
    expect((await shop('me/addresses/8', { method: 'DELETE', cookie: SIGNED_IN })).status).toBe(404)
    const response = await shop('me/addresses', { method: 'POST', cookie: SIGNED_IN, body: {} })
    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual({ postalCode: ['The postal code is invalid.'], address: ['At most 20.'] })
  })

  it('deletes (204 upstream → { ok: true }) and refuses ids that are not numbers', async () => {
    const calls = fakeUpstream({ 'DELETE /api/v1/me/addresses/7': { status: 204 } })
    const response = await shop('me/addresses/7', { method: 'DELETE', cookie: SIGNED_IN })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect((await shop('me/addresses/..%2Fx', { method: 'DELETE', cookie: SIGNED_IN })).status).toBe(404)
    expect(calls).toHaveLength(1)
  })
})

describe('returns (/api/shop/orders/:number/returns, /api/shop/returns)', () => {
  const API_RETURN = {
    number: 'RMA-100001', order_number: 'BN-100001', status: 'approved', reason: 'Damaged', resolution: null, items_count: 1,
    created_at: '2026-11-16T10:00:00Z', updated_at: '2026-11-16T11:00:00Z', comment: 'Cracked lid', admin_note: 'Please use the prepaid label.', restocked: false,
    items: [{ id: 3, order_item_id: 11, product_id: 1, variant_id: null, sku: 'BEA-1', name: 'Mascara', variant_label: null, thumbnail_url: 't.webp', quantity: 1, condition: null }],
    order: { number: 'BN-100001', status: 'delivered', payment_status: 'paid', placed_at: '2026-11-10T09:41:02Z' },
    credit_memo: null, allowed_transitions: [], can_refund: false,
  }

  it('needs the customer session', async () => {
    const calls = fakeUpstream({})
    expect((await shop('returns')).status).toBe(401)
    expect((await shop('returns/RMA-100001')).status).toBe(401)
    expect((await shop('orders/BN-100001/returns', { method: 'POST', body: {} })).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('asks for a return with only order line ids, quantities, the reason, and the comment', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/orders/BN-100001/returns': { status: 201, body: { data: { ...API_RETURN, status: 'requested' } } } })
    const response = await shop('orders/BN-100001/returns', {
      method: 'POST',
      cookie: SIGNED_IN,
      body: { items: [{ orderItemId: 11, quantity: 1, price: 0 }], reason: 'Damaged', comment: '  Cracked lid  ', status: 'approved' },
    })
    expect(response.status).toBe(201)
    expect(calls[0].body).toEqual({ items: [{ order_item_id: 11, quantity: 1 }], reason: 'Damaged', comment: 'Cracked lid' })
    expect(await response.json()).toMatchObject({ number: 'RMA-100001', status: 'requested', orderNumber: 'BN-100001' })
  })

  it('maps a return for the customer: items, refund, the message they were emailed; no staff fields', async () => {
    fakeUpstream({ 'GET /api/v1/returns/RMA-100001': { body: { data: API_RETURN } } })
    const body = await (await shop('returns/RMA-100001', { cookie: SIGNED_IN })).json()
    expect(body).toEqual({
      number: 'RMA-100001', orderNumber: 'BN-100001', status: 'approved', reason: 'Damaged', resolution: null, itemsCount: 1,
      createdAt: '2026-11-16T10:00:00Z', updatedAt: '2026-11-16T11:00:00Z', comment: 'Cracked lid', message: 'Please use the prepaid label.',
      items: [{ id: 3, orderItemId: 11, productId: 1, title: 'Mascara', sku: 'BEA-1', variantLabel: null, thumbnail: 't.webp', quantity: 1, condition: null }],
      order: { number: 'BN-100001', status: 'delivered', placedAt: '2026-11-10T09:41:02Z' },
      refund: null,
    })
  })

  it('lists returns a page at a time', async () => {
    const summary = { number: 'RMA-100001', order_number: 'BN-100001', status: 'requested', reason: 'Damaged', resolution: null, items_count: 2, created_at: '2026-11-16T10:00:00Z' }
    const calls = fakeUpstream({ 'GET /api/v1/returns': { body: { data: [summary], meta: { total: 1, current_page: 2, per_page: 10, last_page: 2 } } } })
    const body = await (await shop('returns?page=2', { cookie: SIGNED_IN })).json()
    expect(calls[0].search).toBe('?page=2')
    expect(body).toMatchObject({ total: 1, page: 2, perPage: 10, lastPage: 2 })
    expect(body.returns[0]).toEqual({ number: 'RMA-100001', orderNumber: 'BN-100001', status: 'requested', reason: 'Damaged', resolution: null, itemsCount: 2, createdAt: '2026-11-16T10:00:00Z', updatedAt: null })
  })

  it('refuses malformed return numbers without calling the API', async () => {
    const calls = fakeUpstream({})
    expect((await shop('returns/RMA-1x', { cookie: SIGNED_IN })).status).toBe(404)
    expect((await shop('orders/BN-1/returns/x', { method: 'POST', cookie: SIGNED_IN })).status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('maps what an order can still return (return_eligibility)', async () => {
    fakeUpstream({
      'GET /api/v1/orders/BN-100001': {
        body: {
          data: {
            number: 'BN-100001', status: 'delivered', items: [], totals: {}, customer_group: 'Wholesale',
            returns: [{ number: 'RMA-100001', status: 'requested', created_at: '2026-11-16T10:00:00Z' }],
            return_eligibility: {
              eligible: true, code: null, message: null, deadline: '2026-12-16T10:00:00Z', window_days: 30, reasons: ['Damaged', 'Other'],
              items: [{ order_item_id: 11, name: 'Mascara', variant_label: null, sku: 'BEA-1', thumbnail_url: 't.webp', ordered: 2, returnable: 1 }],
            },
          },
        },
      },
    })
    const order = await (await shop('orders/BN-100001', { cookie: SIGNED_IN })).json()
    expect(order.customerGroup).toBe('Wholesale')
    expect(order.returns).toEqual([{ number: 'RMA-100001', status: 'requested', createdAt: '2026-11-16T10:00:00Z' }])
    expect(order.returnEligibility).toEqual({
      eligible: true, code: null, message: null, deadline: '2026-12-16T10:00:00Z', windowDays: 30, reasons: ['Damaged', 'Other'],
      items: [{ orderItemId: 11, title: 'Mascara', variantLabel: null, sku: 'BEA-1', thumbnail: 't.webp', ordered: 2, returnable: 1 }],
    })
  })
})

describe('customer groups and the address book at checkout', () => {
  const LINE = { product_id: 1, sku: 'BEA-1', name: 'Mascara', price: '10.00', discount_percent: 0, group_discount_percent: 10, base_sale_price: '10.00', sale_price: '9.00', quantity: 2, line_total: '18.00', available: true }
  const TOTALS = { item_count: 2, subtotal: '18.00', discount: '0.00', group_discount: '2.00', shipping: '4.99', tax: '0.00', total: '22.99' }

  it("prices the cart with the customer's group and says which group it was", async () => {
    fakeUpstream({ 'POST /api/v1/cart/validate': { body: { data: { lines: [LINE], problems: [], totals: TOTALS, customer_group: { name: 'Wholesale', discount_percent: '10.00' } } } } })
    const cart = await (await shop('cart/validate', { method: 'POST', cookie: SIGNED_IN, body: { items: [{ productId: 1, quantity: 2 }] } })).json()
    expect(cart.customerGroup).toEqual({ name: 'Wholesale', discountPercent: 10 })
    expect(cart.totals.groupDiscount).toBe(2)
    expect(cart.lines[0]).toMatchObject({ salePrice: 9, lineTotal: 18, groupDiscountPercent: 10, baseSalePrice: 10 })
  })

  it('leaves the group fields out of lines without a group discount', async () => {
    fakeUpstream({ 'POST /api/v1/cart/validate': { body: { data: { lines: [{ ...LINE, group_discount_percent: 0 }], totals: TOTALS, customer_group: { name: 'General', discount_percent: '0.00' } } } } })
    const cart = await (await shop('cart/validate', { method: 'POST', body: { items: [{ productId: 1, quantity: 2 }] } })).json()
    expect(cart.lines[0]).not.toHaveProperty('groupDiscountPercent')
    expect(cart.customerGroup).toEqual({ name: 'General', discountPercent: 0 })
  })

  it('sends save_address only for signed-in customers', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/orders': { status: 201, body: { data: { number: 'BN-100002', items: [], totals: {} } } } })
    await shop('orders', { method: 'POST', cookie: SIGNED_IN, body: { items: [], saveAddress: true } })
    await shop('orders', { method: 'POST', body: { items: [], saveAddress: true } }) // a guest
    await shop('orders', { method: 'POST', cookie: SIGNED_IN, body: { items: [], saveAddress: 'yes' } })
    expect(calls[0].body.save_address).toBe(true)
    expect(calls[1].body).not.toHaveProperty('save_address')
    expect(calls[2].body).not.toHaveProperty('save_address')
  })

  it("adds the customer's group to the profile (/api/auth/me)", async () => {
    vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
    fakeUpstream({
      'GET /api/v1/me': { body: { data: { id: 5, first_name: 'Nadia', last_name: 'Rahman', email: 'nadia@example.com', phone: null, email_verified: true, group: { name: 'Wholesale', discount_percent: '10.00' } } } },
    })
    const profile = await (await auth('me', { cookie: SIGNED_IN })).json()
    expect(profile.group).toEqual({ name: 'Wholesale', discountPercent: 10 })
  })
})
