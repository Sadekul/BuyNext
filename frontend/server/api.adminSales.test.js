// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

/*
 * Phase 6 admin routes (adminSalesApi.js, shop/adminSales.js): customer
 * groups, the customer profile and address book, notes, admin-created
 * orders, mass actions, CSV, packing slips, shipments, and returns. Laravel is
 * faked; each call is recorded with its raw body. Shapes from the backend's
 * implementation notes in docs/backend/PHASE6_CONTRACT.md.
 */

const SITE = 'https://shop.example'
const ME = { id: 1, name: 'Store Admin', email: 'admin@buynest.test', role: { id: 1, name: 'Owner' }, permissions: ['orders.view'] }

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const entry = { method: init.method ?? 'GET', path: pathname, search, headers: init.headers ?? {}, body: init.body }
    calls.push(entry)
    const key = `${entry.method} ${pathname}`
    const found = key === 'GET /api/admin/v1/me' ? { body: { data: ME } } : routes[key]
    const route = typeof found === 'function' ? found(entry) : (found ?? { status: 404, body: { message: 'Not found' } })
    if (typeof route.body === 'string') return new Response(route.body, { status: route.status ?? 200, headers: route.headers })
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

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const GROUP = { id: 2, name: 'Wholesale', code: 'wholesale', discount_percent: '10.00', is_system: false, is_default: false, customers_count: 3 }
const CUSTOMER = {
  id: 5, first_name: 'Nadia', last_name: 'Rahman', email: 'nadia@example.com', phone: '+15550100100', email_verified_at: '2026-11-10T08:00:00Z', email_verified: true,
  is_active: true, status: 'active', group: { id: 2, name: 'Wholesale', code: 'wholesale', discount_percent: '10.00' }, orders_count: 4, created_by_admin: false,
  last_login_at: null, created_at: '2026-11-10T08:00:00Z', password: 'never', remember_token: 'never',
}
const ADDRESS = { id: 4, first_name: 'Nadia', last_name: 'Rahman', company: null, phone: '+15550100100', line1: '1 Main St', line2: null, city: 'Austin', state: 'TX', postal_code: '78701', country: 'United States', is_default_shipping: true, is_default_billing: false }

describe('customer groups', () => {
  it('lists, creates (code optional), and passes the delete guard on', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/customer-groups': { body: { data: [GROUP] } },
      'POST /api/admin/v1/customer-groups': { status: 201, body: { data: { ...GROUP, id: 7, name: 'Trade', code: 'trade', discount_percent: '12.50' } } },
      'DELETE /api/admin/v1/customer-groups/2': { status: 422, body: { message: 'In use.', errors: { group: ['3 customers are in the Wholesale group.'] } } },
    })
    expect(await (await admin('customer-groups')).json()).toEqual({
      groups: [{ id: 2, name: 'Wholesale', code: 'wholesale', discountPercent: 10, isSystem: false, isDefault: false, customerCount: 3, createdAt: null, updatedAt: null }],
      live: true,
    })
    expect((await admin('customer-groups', { method: 'POST', body: { name: 'Trade', discountPercent: 95 } })).status).toBe(422)
    expect((await admin('customer-groups', { method: 'POST', body: { name: 'Trade', code: 'Trade!', discountPercent: 5 } })).status).toBe(422)
    const created = await admin('customer-groups', { method: 'POST', body: { name: ' Trade ', discountPercent: 12.5, isSystem: true } })
    expect(created.status).toBe(201)
    expect(sent(toApi(calls).at(-1))).toEqual({ name: 'Trade', discount_percent: '12.50' })
    const refused = await admin('customer-groups/2', { method: 'DELETE' })
    expect(refused.status).toBe(422)
    expect(await refused.json()).toMatchObject({ errors: { group: ['3 customers are in the Wholesale group.'] } })
  })
})

describe('customers', () => {
  it('lists with the new filters in API names, and never sends secrets to the browser', async () => {
    const calls = fakeLaravel({ 'GET /api/admin/v1/customers': { body: { data: [CUSTOMER], meta: { total: 41 } } } })
    const list = await (await admin('customers?q=nadia&status=active&verified=no&groupId=2&createdFrom=2026-11-01&createdTo=nope&limit=20&skip=20')).json()
    expect(list).toMatchObject({ total: 41, manageable: true, customers: [{ id: 5, group: { id: 2, name: 'Wholesale', discountPercent: 10 }, groupId: 2, status: 'active', ordersCount: 4 }] })
    expect(JSON.stringify(list)).not.toMatch(/never/)
    expect(Object.fromEntries(new URLSearchParams(toApi(calls)[0].search))).toEqual({ page: '2', per_page: '20', search: 'nadia', status: 'active', verified: '0', group_id: '2', created_from: '2026-11-01' })
  })

  it('reads the full profile, creates (phone required), and edits the account', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/customers/5': {
        body: {
          data: {
            ...CUSTOMER, addresses: [ADDRESS], lifetime_spent: '123.45', reviews_count: 1,
            recent_orders: [{ number: 'BN-100009', status: 'delivered', payment_status: 'paid', source: 'admin', item_count: 2, total: '99.50', placed_at: 'T' }],
            notes: [{ id: 1, body: 'VIP', admin: { id: 1, name: 'Store Admin' }, created_at: 'T' }],
          },
        },
      },
      'POST /api/admin/v1/customers': { status: 201, body: { data: { ...CUSTOMER, id: 9 } } },
      'PATCH /api/admin/v1/customers/5': { body: { data: { ...CUSTOMER, email: 'new@example.com', email_verified: false, email_verified_at: null } } },
    })
    const profile = await (await admin('customers/5')).json()
    expect(profile).toMatchObject({
      lifetimeSpent: 123.45, reviewsCount: 1, ordersCount: 4,
      addresses: [{ id: 4, line1: '1 Main St', postalCode: '78701', isDefaultShipping: true, isDefaultBilling: false, company: '' }],
      recentOrders: [{ number: 'BN-100009', source: 'admin', total: 99.5, items: 2 }],
      notes: [{ id: 1, body: 'VIP', adminName: 'Store Admin' }],
    })
    expect((await admin('customers', { method: 'POST', body: { firstName: 'Omar', lastName: 'Faruk', email: 'omar@example.com' } })).status).toBe(422)
    const created = await admin('customers', { method: 'POST', body: { firstName: 'Omar', lastName: 'Faruk', email: ' Omar@Example.com ', phone: '+1 555 010 0199', groupId: 2, isActive: false } })
    expect(created.status).toBe(201)
    expect(sent(toApi(calls).at(-1))).toEqual({ first_name: 'Omar', last_name: 'Faruk', email: 'omar@example.com', phone: '+1 555 010 0199', group_id: 2 })
    const edited = await (await admin('customers/5', { method: 'PATCH', body: { email: 'new@example.com', groupId: 3 } })).json()
    expect(edited).toMatchObject({ id: 5, email: 'new@example.com', emailVerified: false })
    expect(sent(toApi(calls).at(-1))).toEqual({ email: 'new@example.com', group_id: 3 })
  })

  it('deletes (422 guard passed on), sends a password reset (429 passed on), and exports CSV', async () => {
    let tooSoon = false
    fakeLaravel({
      'DELETE /api/admin/v1/customers/5': { status: 422, body: { message: 'Open orders.', errors: { customer: ['This customer has 1 open order.'] } } },
      'DELETE /api/admin/v1/customers/6': { status: 204 },
      'POST /api/admin/v1/customers/5/password-reset': () => {
        const answer = tooSoon ? { status: 429, body: { message: 'Try again in a minute.', code: 'too_soon' } } : { body: { message: 'Sent.', data: { email: 'n@x.co', resend_in: 60 } } }
        tooSoon = true
        return answer
      },
      'GET /api/admin/v1/customers/export.csv': (entry) => ({ body: `id,first_name\n5,Nadia\n${entry.search}`, headers: { 'Content-Type': 'text/csv; charset=UTF-8', 'Content-Disposition': 'attachment; filename="customers-2026-11-16.csv"' } }),
    })
    expect(await (await admin('customers/5', { method: 'DELETE' })).json()).toMatchObject({ errors: { customer: ['This customer has 1 open order.'] } })
    expect(await (await admin('customers/6', { method: 'DELETE' })).json()).toEqual({ id: 6, deleted: true, live: true })
    expect(await (await admin('customers/5/password-reset', { method: 'POST' })).json()).toEqual({ sent: true, message: 'Sent.' })
    const again = await admin('customers/5/password-reset', { method: 'POST' })
    expect(again.status).toBe(429)
    expect(await again.json()).toEqual({ message: 'Try again in a minute.', code: 'too_soon' })
    const csv = await admin('customers/export.csv?q=nadia&groupId=2')
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=UTF-8')
    expect(csv.headers.get('content-disposition')).toBe('attachment; filename="customers-2026-11-16.csv"')
    expect(await csv.text()).toContain('?search=nadia&group_id=2')
  })

  it('manages the address book (phone required) and notes', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/customers/5/addresses': { status: 201, body: { data: ADDRESS } },
      'PATCH /api/admin/v1/customers/5/addresses/4': { body: { data: { ...ADDRESS, is_default_billing: true } } },
      'DELETE /api/admin/v1/customers/5/addresses/4': { status: 204 },
      'POST /api/admin/v1/customers/5/notes': { status: 201, body: { data: { id: 3, body: 'Hi', admin: null, created_at: 'T' } } },
    })
    const address = { firstName: 'Nadia', lastName: 'Rahman', line1: '1 Main St', city: 'Austin', postalCode: '78701', country: 'United States' }
    expect(await (await admin('customers/5/addresses', { method: 'POST', body: address })).json()).toMatchObject({ errors: { phone: expect.any(Array) } })
    expect((await admin('customers/5/addresses', { method: 'POST', body: { ...address, phone: '+15550100100', line2: '', isDefaultShipping: true } })).status).toBe(201)
    expect(sent(toApi(calls).at(-1))).toEqual({ first_name: 'Nadia', last_name: 'Rahman', phone: '+15550100100', line1: '1 Main St', line2: null, city: 'Austin', postal_code: '78701', country: 'United States', is_default_shipping: true })
    expect(await (await admin('customers/5/addresses/4', { method: 'PATCH', body: { isDefaultBilling: true } })).json()).toMatchObject({ address: { isDefaultBilling: true } })
    expect(sent(toApi(calls).at(-1))).toEqual({ is_default_billing: true })
    expect(await (await admin('customers/5/addresses/4', { method: 'DELETE' })).json()).toEqual({ deleted: true, live: true })
    expect((await admin('customers/5/addresses/x', { method: 'DELETE' })).status).toBe(404)
    expect((await admin('customers/5/notes', { method: 'POST', body: { body: '  ' } })).status).toBe(422)
    expect(await (await admin('customers/5/notes', { method: 'POST', body: { body: ' Hi ' } })).json()).toEqual({ note: { id: 3, body: 'Hi', adminName: null, createdAt: 'T' }, live: true })
    expect(sent(toApi(calls).at(-1))).toEqual({ body: 'Hi' })
  })
})

describe('orders created by admins', () => {
  const ORDER_BODY = {
    customerId: 5,
    items: [{ productId: 81, quantity: 1 }, { productId: 12, variantId: 40, quantity: 2 }],
    shippingAddress: { firstName: 'Nadia', lastName: 'Rahman', line1: '1 Main St', line2: '', city: 'Austin', state: 'TX', postalCode: '78701', country: 'United States' },
    sameAsShipping: true,
    shippingMethod: 'express',
    paymentMethod: 'bank_transfer',
    couponCode: ' save10 ',
    note: 'Phone order',
    notifyCustomer: false,
  }

  it('quotes with only the items and the country, and maps the group pricing', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/orders/quote': {
        body: {
          data: {
            lines: [{ product_id: 81, variant_id: null, name: 'Yoga', price: '1099.99', sale_price: '925.15', base_sale_price: '1027.94', group_discount_percent: 10, quantity: 1, line_total: '925.15', available: true }],
            problems: [],
            coupon: null,
            coupon_error: 'This code is not valid.',
            shipping_options: [{ id: 'standard', label: 'Standard', eta: '3–5 days', price: '0.00' }],
            totals: { item_count: 1, subtotal: '925.15', discount: '0.00', shipping: '0.00', tax: '0.00', total: '925.15', group_discount: '102.79' },
            tax_estimated: true,
            customer_group: { name: 'Wholesale', discount_percent: '10.00' },
            payment_methods: ['card', 'bank_transfer', 'cash'],
          },
        },
      },
    })
    const quote = await (await admin('orders/quote', { method: 'POST', body: { ...ORDER_BODY, shippingAddress: { country: 'United States', city: '' }, paymentMethod: undefined } })).json()
    expect(quote).toMatchObject({ customerGroup: 'Wholesale', groupDiscountPercent: 10, paymentMethods: ['card', 'bank_transfer', 'cash'], couponError: 'This code is not valid.', totals: { total: 925.15, groupDiscount: 102.79 } })
    expect(quote.lines[0]).toMatchObject({ productId: 81, salePrice: 925.15, lineTotal: 925.15 })
    expect(sent(toApi(calls)[0])).toEqual({
      customer_id: 5,
      items: [{ product_id: 81, quantity: 1 }, { product_id: 12, variant_id: 40, quantity: 2 }],
      shipping_address: { country: 'United States' },
      same_as_shipping: true,
      shipping_method: 'express',
      coupon_code: 'SAVE10',
      note: 'Phone order',
      notify_customer: false,
    })
    // Only the items are needed for a quote.
    expect((await admin('orders/quote', { method: 'POST', body: { items: [] } })).status).toBe(422)
  })

  it('places an order (all fields checked), passing problems on', async () => {
    let refuse = true
    const calls = fakeLaravel({
      'POST /api/admin/v1/orders': () =>
        refuse
          ? { status: 422, body: { message: "Some items can't be ordered.", errors: { items: ['Only 1 left.'] }, problems: [{ product_id: 81, variant_id: null, code: 'out_of_stock', message: 'Only 1 left.' }] } }
          : { status: 201, body: { data: { number: 'BN-100200', status: 'pending_payment', payment_status: 'unpaid', source: 'admin', totals: { total: '925.15' }, items: [] } } },
    })
    const missing = await (await admin('orders', { method: 'POST', body: { items: [{ productId: 81, quantity: 1 }] } })).json()
    expect(Object.keys(missing.errors)).toEqual(['customerId', 'shippingAddress', 'shippingMethod', 'paymentMethod'])
    expect((await admin('orders', { method: 'POST', body: { ...ORDER_BODY, paymentMethod: 'bitcoin' } })).status).toBe(422)
    const guestMissing = await (await admin('orders', { method: 'POST', body: { ...ORDER_BODY, customerId: undefined, guest: { email: 'x' } } })).json()
    expect(Object.keys(guestMissing.errors)).toEqual(['guest.email', 'guest.phone', 'guest.firstName', 'guest.lastName'])

    const refused = await admin('orders', { method: 'POST', body: ORDER_BODY })
    expect(refused.status).toBe(422)
    expect(await refused.json()).toMatchObject({ problems: [{ productId: 81, code: 'out_of_stock', message: 'Only 1 left.' }] })
    refuse = false
    const placed = await admin('orders', { method: 'POST', body: { ...ORDER_BODY, customerId: undefined, sameAsShipping: false, billingAddress: ORDER_BODY.shippingAddress, guest: { email: 'G@x.co', phone: '+15550100124', firstName: 'Gus', lastName: 'Guest' } } })
    expect(placed.status).toBe(201)
    expect(await placed.json()).toMatchObject({ order: { number: 'BN-100200', source: 'admin', totals: { total: 925.15 } } })
    const body = sent(toApi(calls).at(-1))
    expect(body.guest).toEqual({ email: 'g@x.co', phone: '+15550100124', first_name: 'Gus', last_name: 'Guest' })
    expect(body.billing_address).toEqual({ first_name: 'Nadia', last_name: 'Rahman', line1: '1 Main St', line2: null, city: 'Austin', state: 'TX', postal_code: '78701', country: 'United States' })
    expect(body).not.toHaveProperty('customer_id')
  })
})

describe('order grid, documents, and returns', () => {
  it('runs mass actions (checked), exports CSV with the grid filters, and maps source', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/orders/bulk': { body: { data: { done: ['BN-100001'], skipped: [{ number: 'BN-100002', reason: 'Already invoiced.' }] } } },
      'GET /api/admin/v1/orders/export.csv': (entry) => ({ body: `number\n${entry.search}`, headers: { 'Content-Type': 'text/csv; charset=UTF-8', 'Content-Disposition': 'attachment; filename="orders-2026-11-16.csv"' } }),
      'GET /api/admin/v1/orders': { body: { data: [{ number: 'BN-100001', source: 'admin', email: 'a@x.co', totals: {} }], meta: { total: 1 } } },
    })
    expect((await admin('orders/bulk', { method: 'POST', body: { numbers: ['BN-1', 'BN-1'], action: 'invoice' } })).status).toBe(422)
    expect(await (await admin('orders/bulk', { method: 'POST', body: { numbers: ['BN-100001'], action: 'ship' } })).json()).toMatchObject({ errors: { carrier: expect.any(Array) } })
    expect(await (await admin('orders/bulk', { method: 'POST', body: { numbers: ['BN-100001', 'BN-100002'], action: 'ship', carrier: 'ups', notifyCustomer: false } })).json()).toEqual({
      done: ['BN-100001'],
      skipped: [{ number: 'BN-100002', reason: 'Already invoiced.' }],
      live: true,
    })
    expect(sent(toApi(calls).at(-1))).toEqual({ numbers: ['BN-100001', 'BN-100002'], action: 'ship', carrier: 'ups', notify_customer: false })
    const csv = await admin('orders/export.csv?q=ava&status=shipped&paymentStatus=paid&source=admin&evil=1')
    expect(await csv.text()).toContain('?search=ava&status=shipped&payment_status=paid&source=admin')
    expect(csv.headers.get('content-disposition')).toBe('attachment; filename="orders-2026-11-16.csv"')
    const list = await (await admin('orders?source=admin')).json()
    expect(list.orders[0].source).toBe('admin')
    expect(toApi(calls).at(-1).search).toContain('source=admin')
  })

  it('maps the packing slip (no prices), shipments, and their filters', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/orders/BN-100001/packing-slip': {
        body: {
          data: {
            order_number: 'BN-100001', placed_at: 'T', status: 'shipped', email: 'a@x.co', phone: '+1', shipping_method: { id: 'standard', label: 'Standard' },
            ship_to: { first_name: 'Ava', last_name: 'C', line1: '1 Main', city: 'Austin', postal_code: '78701', country: 'United States' },
            items: [{ order_item_id: 3, sku: 'S', name: 'Mascara', variant_label: 'Color: Black', quantity: 2, price: '9.99' }],
            item_count: 2, shipments: [{ number: 'SHP-100001', carrier: 'ups', carrier_label: 'UPS', tracking_number: '1Z' }],
            store: { name: 'BuyNest', address: '1 Store St', support_email: 's@x.co', support_phone: '+1' },
          },
        },
      },
      'GET /api/admin/v1/shipments': { body: { data: [{ number: 'SHP-100001', order_number: 'BN-100001', carrier: 'ups', carrier_label: 'UPS', tracking_url: 'javascript:alert(1)', item_count: 2, order: { number: 'BN-100001', customer_name: 'Ava C', ship_to: 'Austin, United States' } }], meta: { total: 1 } } },
      'GET /api/admin/v1/shipments/SHP-100001': { body: { data: { number: 'SHP-100001', carrier: 'ups', items: [{ name: 'Mascara', quantity: 2 }], order: { number: 'BN-100001', shipping_method: { id: 'standard', label: 'Standard' } } } } },
    })
    const slip = await (await admin('orders/BN-100001/packing-slip')).json()
    expect(slip).toMatchObject({ orderNumber: 'BN-100001', customerName: 'Ava C', shippingMethod: 'Standard', shippingAddress: { city: 'Austin' }, storeName: 'BuyNest', items: [{ name: 'Mascara', variantLabel: 'Color: Black', quantity: 2 }] })
    expect(JSON.stringify(slip)).not.toMatch(/9\.99/)
    const list = await (await admin('shipments?q=BN-100001&carrier=ups&from=2026-11-01&to=bad&limit=10')).json()
    expect(list).toMatchObject({ total: 1, shipments: [{ number: 'SHP-100001', trackingUrl: null, itemCount: 2, order: { customerName: 'Ava C', shipTo: 'Austin, United States' } }] })
    expect(Object.fromEntries(new URLSearchParams(toApi(calls).at(-1).search))).toEqual({ page: '1', per_page: '10', search: 'BN-100001', carrier: 'ups', from: '2026-11-01' })
    expect(await (await admin('shipments/SHP-100001')).json()).toMatchObject({ items: [{ name: 'Mascara', quantity: 2 }], order: { shippingMethod: 'Standard' } })
    expect((await admin('shipments/BN-100001')).status).toBe(404)
  })

  const RETURN = {
    number: 'RMA-100001', order_number: 'BN-100001', status: 'received', reason: 'Damaged', resolution: null, items_count: 1, email: 'a@x.co',
    customer: { id: 5, name: 'Ava C', email: 'a@x.co' }, created_by_admin: { id: 1, name: 'Store Admin' }, comment: 'Cracked', admin_note: null, restocked: true,
    items: [{ id: 11, order_item_id: 3, product_id: 1, sku: 'S', name: 'Mascara', variant_label: null, quantity: 1, condition: 'damaged' }],
    credit_memo: null, allowed_transitions: ['closed'], can_refund: true, created_at: 'T',
  }

  it('lists, reads, moves, and creates returns; a refund names its return', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/returns': { body: { data: [RETURN], meta: { total: 1, counts: { requested: 2, received: 1 } } } },
      'GET /api/admin/v1/returns/RMA-100001': { body: { data: RETURN } },
      'PATCH /api/admin/v1/returns/RMA-100001': { body: { data: { ...RETURN, status: 'closed', allowed_transitions: [], can_refund: false } } },
      'POST /api/admin/v1/orders/BN-100001/returns': { status: 201, body: { data: { ...RETURN, status: 'requested' } } },
      'POST /api/admin/v1/orders/BN-100001/credit-memos': { status: 201, body: { data: { number: 'CM-100009', total: '8.94', return_number: 'RMA-100001', items: [] } } },
    })
    const list = await (await admin('returns?status=received&q=ava')).json()
    expect(list).toMatchObject({ total: 1, counts: { requested: 2, received: 1 }, returns: [{ number: 'RMA-100001', itemCount: 1, customer: { name: 'Ava C' } }] })
    expect(toApi(calls).at(-1).search).toContain('status=received')
    expect(await (await admin('returns/RMA-100001')).json()).toMatchObject({ allowedTransitions: ['closed'], canRefund: true, restocked: true, createdByAdmin: 'Store Admin', items: [{ id: 11, orderItemId: 3, condition: 'damaged' }] })
    expect((await admin('returns/BN-1')).status).toBe(404)

    expect((await admin('returns/RMA-100001', { method: 'PATCH', body: { status: 'refunded' } })).status).toBe(422)
    expect(await (await admin('returns/RMA-100001', { method: 'PATCH', body: { status: 'received', items: [{ returnItemId: 11, condition: 'broken' }] } })).json()).toMatchObject({ errors: { 'items.0.condition': expect.any(Array) } })
    await admin('returns/RMA-100001', { method: 'PATCH', body: { status: 'received', items: [{ returnItemId: 11, condition: 'opened' }], restock: true, adminNote: ' ok ', notifyCustomer: false } })
    expect(sent(toApi(calls).at(-1))).toEqual({ status: 'received', admin_note: 'ok', items: [{ return_item_id: 11, condition: 'opened' }], restock: true, notify_customer: false })
    expect(await (await admin('returns/RMA-100001', { method: 'PATCH', body: { status: 'closed' } })).json()).toMatchObject({ return: { status: 'closed', allowedTransitions: [] } })

    expect((await admin('orders/BN-100001/returns', { method: 'POST', body: { items: [], reason: 'Damaged' } })).status).toBe(422)
    const created = await admin('orders/BN-100001/returns', { method: 'POST', body: { items: [{ orderItemId: 3, quantity: 1 }], reason: 'Damaged', overrideWindow: true } })
    expect(created.status).toBe(201)
    expect(sent(toApi(calls).at(-1))).toEqual({ items: [{ order_item_id: 3, quantity: 1 }], reason: 'Damaged', override_window: true, notify_customer: true })

    expect((await admin('orders/BN-100001/credit-memos', { method: 'POST', body: { items: [{ orderItemId: 3, quantity: 1 }], returnNumber: 'nope' } })).status).toBe(422)
    const memo = await (await admin('orders/BN-100001/credit-memos', { method: 'POST', body: { items: [{ orderItemId: 3, quantity: 1 }], returnNumber: 'RMA-100001' } })).json()
    expect(memo.creditMemo.returnNumber).toBe('RMA-100001')
    expect(sent(toApi(calls).at(-1)).return_number).toBe('RMA-100001')
  })

  it('maps the order detail additions (source, group, creator, returns, eligibility)', async () => {
    fakeLaravel({
      'GET /api/admin/v1/orders/BN-100001': {
        body: {
          data: {
            number: 'BN-100001', status: 'delivered', source: 'admin', customer_group: 'Wholesale', created_by_admin: { id: 1, name: 'Store Admin' }, items: [], totals: {}, history: [],
            returns: [{ number: 'RMA-100001', status: 'requested', items_count: 1, created_at: 'T' }],
            return_eligibility: { eligible: true, code: null, message: null, deadline: 'D', window_days: 30, reasons: ['Damaged'], items: [{ order_item_id: 3, name: 'Mascara', variant_label: null, sku: 'S', ordered: 2, returnable: 1 }] },
          },
        },
      },
    })
    expect(await (await admin('orders/BN-100001')).json()).toMatchObject({
      source: 'admin', customerGroup: 'Wholesale', createdByAdmin: 'Store Admin',
      returns: [{ number: 'RMA-100001', status: 'requested', itemCount: 1 }],
      returnEligibility: { eligible: true, windowDays: 30, reasons: ['Damaged'], items: [{ orderItemId: 3, ordered: 2, returnable: 1 }] },
    })
  })

  it('checks the returns settings group', async () => {
    const calls = fakeLaravel({ 'PATCH /api/admin/v1/settings': { body: { data: { returns: { returns_enabled: false, return_window_days: 14, return_reasons: ['Damaged'] } } } } })
    expect((await admin('settings', { method: 'PATCH', body: { returns: { returnReasons: ['A', 'a'] } } })).status).toBe(422)
    expect((await admin('settings', { method: 'PATCH', body: { returns: { returnWindowDays: 0 } } })).status).toBe(422)
    const saved = await (await admin('settings', { method: 'PATCH', body: { returns: { returnsEnabled: false, returnWindowDays: 14, returnReasons: [' Damaged '] } } })).json()
    expect(saved.returns).toEqual({ returnsEnabled: false, returnWindowDays: 14, returnReasons: ['Damaged'] })
    expect(sent(toApi(calls).at(-1))).toEqual({ returns: { returns_enabled: false, return_window_days: 14, return_reasons: ['Damaged'] } })
  })

  it('answers 404 without calling the API for the demo data', async () => {
    vi.stubEnv('VITE_API_PROVIDER', 'dummyjson')
    const calls = fakeLaravel({})
    for (const path of ['returns', 'shipments', 'customer-groups', 'customers/5']) expect((await admin(path)).status).toBe(404)
    expect(toApi(calls)).toEqual([])
  })
})
