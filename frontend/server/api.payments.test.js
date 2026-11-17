// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { MAX_WEBHOOK_BYTES } from './paymentsApi'

// Phase 8 (docs/backend/PHASE8_CONTRACT.md §1): the Stripe webhook, Pay now, and payment fields.
const SITE = 'https://shop.example'

/** Fakes the Laravel API: "METHOD /path" → { status, body }. Records each call with its raw body. */
function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname } = new URL(url)
    calls.push({ path: pathname, init })
    const route = routes[`${init.method ?? 'GET'} ${pathname}`] ?? { status: 404, body: { message: 'Not found' } }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

const request = (path, { method = 'POST', headers = {}, body } = {}) => handleApiRequest(new Request(`${SITE}${path}`, { method, headers, body }))
const STRIPE_PAYMENT = { provider: 'stripe', paid_at: null, url: 'https://checkout.stripe.com/c/pay/cs_test_1#x', expires_at: '2026-11-16T10:30:00Z', can_pay: true }
const ORDER = {
  number: 'BN-100001', status: 'pending_payment', payment_status: 'unpaid', payment_method: 'card', shipping_method: { id: 'standard', label: 'Standard', eta: '3–5 days' },
  email: 'ava@example.com', phone: '+15550100100', items: [], totals: { item_count: 0, subtotal: '0.00', discount: '0.00', shipping: '0.00', tax: '0.00', total: '22.87' },
  placed_at: '2026-11-16T10:00:00Z', payment: STRIPE_PAYMENT,
}

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
  vi.stubEnv('BUYNEST_BFF_KEY', 'shared-secret')
})
afterEach(() => vi.unstubAllEnvs())

describe('Stripe webhook (POST /api/payments/stripe/webhook)', () => {
  // Odd spacing, key order, and non-ASCII text: any parse + re-serialize would change these bytes.
  const RAW = '{"id":"evt_1",  "type":"checkout.session.completed","data":{"object":{"metadata":{"order_number":"BN-100001"},"note":"café ✓"}}}\n'
  const SIGNATURE = 't=1763287200,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8a2111e9b'

  it('forwards the exact bytes and the Stripe-Signature header, with the shared key, and passes the status through', async () => {
    const calls = fakeLaravel({ 'POST /api/v1/payments/stripe/webhook': { status: 200, body: { received: true, result: 'paid' } } })
    const response = await request('/api/payments/stripe/webhook', {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Stripe-Signature': SIGNATURE, 'X-BuyNest-Bff': 'forged', 'X-Real-IP': '54.187.174.169', Cookie: 'buynest_at=1|TOKEN' },
      body: RAW,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true })
    expect(calls).toHaveLength(1)
    const sent = calls[0].init
    expect(Buffer.from(sent.body).equals(Buffer.from(RAW, 'utf8'))).toBe(true)
    expect(sent.headers['Stripe-Signature']).toBe(SIGNATURE)
    expect(sent.headers['Content-Type']).toBe('application/json; charset=utf-8')
    // The key comes from the server's environment, never from the request; no customer token either.
    expect(sent.headers['X-BuyNest-Bff']).toBe('shared-secret')
    expect(sent.headers['X-Client-IP']).toBe('54.187.174.169')
    expect(sent.headers.Authorization).toBeUndefined()
  })

  it('passes a bad signature (400) back unchanged, and works without Fetch Metadata or with a cross-site label', async () => {
    fakeLaravel({ 'POST /api/v1/payments/stripe/webhook': { status: 400, body: { message: 'Invalid Stripe signature.' } } })
    const response = await request('/api/payments/stripe/webhook', { headers: { 'Stripe-Signature': 't=1,v1=00', 'Sec-Fetch-Site': 'cross-site' }, body: RAW })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ message: 'Invalid Stripe signature.' })
  })

  it('refuses without a signature, over the size cap, other methods, and other paths, without calling the API', async () => {
    const calls = fakeLaravel({})
    expect((await request('/api/payments/stripe/webhook', { body: RAW })).status).toBe(400)
    expect((await request('/api/payments/stripe/webhook', { headers: { 'Stripe-Signature': SIGNATURE }, body: 'x'.repeat(MAX_WEBHOOK_BYTES + 1) })).status).toBe(413)
    const get = await request('/api/payments/stripe/webhook', { method: 'GET' })
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
    expect((await request('/api/payments/paypal/webhook', { headers: { 'Stripe-Signature': SIGNATURE }, body: RAW })).status).toBe(404)
    expect(calls).toEqual([])
  })

  it('answers 502 when the API is down, so Stripe retries', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    expect((await request('/api/payments/stripe/webhook', { headers: { 'Stripe-Signature': SIGNATURE }, body: RAW })).status).toBe(502)
  })
})

describe('Pay now and payment fields (shop)', () => {
  const shop = (path, { body, cookie } = {}) =>
    request(`/api/shop/${path}`, { headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }) }, body: body && JSON.stringify(body) })

  it('a placed card order carries its payment page; staff-only keys never reach the browser', async () => {
    fakeLaravel({ 'POST /api/v1/orders': { status: 201, body: { data: { ...ORDER, payment: { ...STRIPE_PAYMENT, reference: 'pi_1', dashboard_url: 'https://dashboard.stripe.com/test/payments/pi_1' } } } } })
    const order = await (await shop('orders', { body: { items: [], paymentMethod: 'card' } })).json()
    expect(order).toMatchObject({ paymentProvider: 'stripe', paidAt: null, canPay: true, paymentExpiresAt: '2026-11-16T10:30:00Z' })
    expect(order.payment).toEqual({ provider: 'stripe', url: STRIPE_PAYMENT.url, expiresAt: '2026-11-16T10:30:00Z', paidAt: null, canPay: true })
    expect(JSON.stringify(order)).not.toMatch(/pi_1|dashboard/)
  })

  it('Stripe unreachable at checkout: url null with the error; a non-https url never gets through', async () => {
    fakeLaravel({ 'POST /api/v1/orders': { status: 201, body: { data: { ...ORDER, payment: { ...STRIPE_PAYMENT, url: null, error: 'Stripe could not be reached. Please try again in a moment.' } } } } })
    expect((await (await shop('orders', { body: {} })).json()).payment).toMatchObject({ url: null, error: 'Stripe could not be reached. Please try again in a moment.' })
    fakeLaravel({ 'POST /api/v1/orders': { status: 201, body: { data: { ...ORDER, payment: { ...STRIPE_PAYMENT, url: 'javascript:alert(1)' } } } } })
    expect((await (await shop('orders', { body: {} })).json()).payment.url).toBeNull()
  })

  it('a guest pays with the order email; a customer with their session; only the payment comes back', async () => {
    const calls = fakeLaravel({ 'POST /api/v1/orders/BN-100001/pay': { body: { data: ORDER } } })
    const guest = await shop('orders/BN-100001/pay', { body: { email: ' ava@example.com ', number: 'BN-1', price: 1 } })
    expect(await guest.json()).toEqual({ provider: 'stripe', url: STRIPE_PAYMENT.url, expiresAt: '2026-11-16T10:30:00Z', paidAt: null, canPay: true })
    expect(JSON.parse(calls[0].init.body)).toEqual({ email: 'ava@example.com' })
    expect(calls[0].init.headers.Authorization).toBeUndefined()
    expect(calls[0].init.headers['X-BuyNest-Bff']).toBe('shared-secret')

    await shop('orders/BN-100001/pay', { cookie: 'buynest_at=1|ACCESS' })
    expect(calls[1].init.headers.Authorization).toBe('Bearer 1|ACCESS')
    expect(JSON.parse(calls[1].init.body)).toEqual({})
  })

  it('passes the refusal (422) and "not found" (404) through; malformed numbers never reach the API', async () => {
    const calls = fakeLaravel({ 'POST /api/v1/orders/BN-100001/pay': { status: 422, body: { message: 'This order has already been paid.', errors: { order: ['This order has already been paid.'] } } } })
    const refused = await shop('orders/BN-100001/pay', { body: { email: 'ava@example.com' } })
    expect(refused.status).toBe(422)
    expect(await refused.json()).toEqual({ message: 'This order has already been paid.', errors: { order: ['This order has already been paid.'] } })
    expect((await shop('orders/BN-100002/pay', { body: { email: 'a@b.co' } })).status).toBe(404)
    expect((await shop('orders/..%2Fadmin/pay', { body: {} })).status).toBe(404)
    expect(calls).toHaveLength(2)
  })

  it('the store settings pass card_payments on', async () => {
    fakeLaravel({ 'GET /api/v1/store': { body: { data: { card_payments: 'stripe' } } } })
    const response = await request('/api/catalog/store', { method: 'GET', headers: { 'Sec-Fetch-Site': 'same-origin' } })
    expect((await response.json()).data.card_payments).toBe('stripe')
  })
})

describe('admin: Stripe payment, payment link, refunds', () => {
  const admin = (path, { method = 'GET', body } = {}) =>
    request(`/api/admin/${path}`, { method, headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Cookie: 'buynest_admin_at=A|TOKEN' }, body: body && JSON.stringify(body) })
  const ME = { 'GET /api/admin/v1/me': { body: { data: { id: 1, name: 'Store Admin', email: 'admin@buynest.test', role: { id: 1, name: 'Owner' }, permissions: ['orders.view', 'orders.edit'] } } } }
  const ADMIN_ORDER = { ...ORDER, payment: { ...STRIPE_PAYMENT, reference: 'pi_3Abc', dashboard_url: 'https://dashboard.stripe.com/payments/pi_3Abc' } }

  it('the order shows the provider, the reference with the dashboard link the API built (live here), and the link', async () => {
    fakeLaravel({ ...ME, 'GET /api/admin/v1/orders/BN-100001': { body: { data: ADMIN_ORDER } } })
    const order = await (await admin('orders/BN-100001')).json()
    expect(order.payment).toEqual({
      provider: 'stripe', reference: 'pi_3Abc', dashboardUrl: 'https://dashboard.stripe.com/payments/pi_3Abc', mode: 'live',
      paidAt: null, url: STRIPE_PAYMENT.url, expiresAt: '2026-11-16T10:30:00Z', canPay: true,
    })
  })

  it('without a dashboard link from the API, the test dashboard is assumed; odd links and references are dropped', async () => {
    fakeLaravel({ ...ME, 'GET /api/admin/v1/orders/BN-100001': { body: { data: { ...ORDER, payment: { ...STRIPE_PAYMENT, reference: 'pi_9', dashboard_url: 'https://evil.example/pi_9' } } } } })
    expect((await (await admin('orders/BN-100001')).json()).payment).toMatchObject({ reference: 'pi_9', dashboardUrl: 'https://dashboard.stripe.com/test/payments/pi_9', mode: 'test' })
    fakeLaravel({ ...ME, 'GET /api/admin/v1/orders/BN-100001': { body: { data: { ...ORDER, payment: { ...STRIPE_PAYMENT, reference: '../x' } } } } })
    expect((await (await admin('orders/BN-100001')).json()).payment).toMatchObject({ reference: null, dashboardUrl: null })
  })

  it('POST orders/:number/payment-link → { payment, order }; 422 passes through', async () => {
    const calls = fakeLaravel({ ...ME, 'POST /api/admin/v1/orders/BN-100001/payment-link': { body: { data: ADMIN_ORDER } } })
    const result = await (await admin('orders/BN-100001/payment-link', { method: 'POST', body: {} })).json()
    expect(result.payment.url).toBe(STRIPE_PAYMENT.url)
    expect(result.order.number).toBe('BN-100001')
    expect(calls.at(-1).init.headers.Authorization).toBe('Bearer A|TOKEN')

    fakeLaravel({ ...ME, 'POST /api/admin/v1/orders/BN-100001/payment-link': { status: 422, body: { message: "This order isn't paid by card.", errors: { order: ["This order isn't paid by card."] } } } })
    const refused = await admin('orders/BN-100001/payment-link', { method: 'POST', body: {} })
    expect(refused.status).toBe(422)
    expect((await refused.json()).errors).toEqual({ order: ["This order isn't paid by card."] })
  })

  it('a refund Stripe refused (422) keeps its message; a saved memo names the Stripe refund', async () => {
    const body = { items: [{ orderItemId: 1, quantity: 1 }], shippingRefund: 0, adjustment: 0, restock: false, notifyCustomer: true }
    const message = 'Stripe refused the refund: Charge has already been refunded.'
    fakeLaravel({ ...ME, 'POST /api/admin/v1/orders/BN-100001/credit-memos': { status: 422, body: { message, errors: { refund: [message] } } } })
    const refused = await admin('orders/BN-100001/credit-memos', { method: 'POST', body })
    expect(refused.status).toBe(422)
    expect(await refused.json()).toEqual({ message, errors: { refund: [message] } })

    fakeLaravel({ ...ME, 'POST /api/admin/v1/orders/BN-100001/credit-memos': { status: 201, body: { data: { number: 'CM-100001', total: '8.94', refund_reference: 're_1', items: [] } } } })
    expect((await (await admin('orders/BN-100001/credit-memos', { method: 'POST', body })).json()).creditMemo.refundReference).toBe('re_1')
  })
})
