// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { PAYPAL_HEADERS } from './paymentsApi'
import { buildContentSecurityPolicy } from '../vite.config.js'

/*
 * Phase 10 storefront services (docs/backend/PHASE10_CONTRACT.md): search
 * corrections, invoice PDFs, PayPal (capture and webhook), shipping rates and
 * gift cards in cart pricing and orders, the gift card balance check, and the
 * build's Content-Security-Policy for analytics.
 */

const SITE = 'https://shop.example'

/** Fakes the Laravel API: "METHOD /path" → { status, body, raw, headers }. Records each call (url, init, parsed body). */
function fakeUpstream(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (input, init = {}) => {
    const url = new URL(input)
    let body
    try {
      body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    } catch {
      body = undefined
    }
    calls.push({ path: url.pathname, search: url.search, init, body })
    const route = routes[`${init.method ?? 'GET'} ${url.pathname}`] ?? { status: 404, body: { message: 'Not found' } }
    const headers = { 'Content-Type': 'application/json', ...route.headers }
    return new Response(route.raw ?? JSON.stringify(route.body), { status: route.status ?? 200, headers })
  })
  return calls
}

const call = (path, { method = 'GET', body, cookie, headers = {} } = {}) =>
  handleApiRequest(
    new Request(`${SITE}/api/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'X-Real-IP': '203.0.113.7', ...(cookie && { Cookie: cookie }), ...headers },
      body: typeof body === 'string' ? body : body && JSON.stringify(body),
    }),
  )
const SIGNED_IN = 'buynest_at=AT'

beforeEach(() => {
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
  vi.stubEnv('BUYNEST_BFF_KEY', 'shared-key')
})
afterEach(() => vi.unstubAllEnvs())

describe('search (GET /api/catalog/products)', () => {
  it('forwards correct=0 and passes meta.corrected_query on', async () => {
    const calls = fakeUpstream({
      'GET /api/v1/products': { body: { data: [], meta: { current_page: 1, per_page: 12, total: 0, last_page: 1, path: 'http://laravel.test/api/v1/products', redirect_url: null, corrected_query: 'iphone' } } },
    })
    const response = await call('catalog/products?search=ihpone&correct=0&page=1&secret=x')
    expect(calls[0].search).toBe('?search=ihpone&correct=0&page=1')
    expect((await response.json()).meta).toEqual({ current_page: 1, per_page: 12, total: 0, last_page: 1, redirect_url: null, corrected_query: 'iphone' })
  })
})

const GIFT_LINE = {
  product_id: 30, sku: 'GC-1', name: 'BuyNest Gift Card', price: '50.00', discount_percent: 0, sale_price: '50.00', quantity: 1, line_total: '50.00', discount: '0.00',
  stock_quantity: 0, min_order_quantity: 1, available: true, type: 'gift_card', requires_shipping: false,
  gift_card: { amount: '50.00', recipient_name: 'Sam Lee', recipient_email: 'sam@example.com', message: 'Happy birthday' },
}
const QUOTE = {
  lines: [GIFT_LINE], problems: [], coupon: null, coupon_error: null, applied_rules: [],
  shipping_options: [{ id: 'express', label: 'Express', eta: '1–2 days', price: '9.50', source: 'table' }],
  shipping_method: 'express', shipping_required: true, shipping_error: null, weight_grams: 1500,
  gift_card: { last4: 'ABCD', balance: '80.00', applied: '24.99', balance_after: '55.01', expires_at: null }, gift_card_error: null,
  totals: { item_count: 1, subtotal: '50.00', discount: '0.00', shipping: '9.50', tax: '0.00', total: '59.50', gift_card: '24.99', amount_due: '34.51' },
}

describe('cart pricing and orders with gift cards and shipping rates', () => {
  it('sends gift card lines, the gift card code (normalised), and the country; maps the answer', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/cart/validate': { body: { data: QUOTE } } })
    const response = await call('shop/cart/validate', {
      method: 'POST',
      body: {
        items: [{ productId: 30, quantity: 1, price: 0.01, giftCard: { amount: 50, recipientName: ' Sam Lee ', recipientEmail: 'sam@example.com', message: 'Happy birthday', code: 'nope' } }],
        couponCode: null,
        shippingMethod: 'express',
        country: 'Germany',
        giftCardCode: 'abcd-efgh ijkl mnop',
      },
    })
    expect(calls[0].body).toEqual({
      items: [{ product_id: 30, quantity: 1, gift_card: { amount: '50.00', recipient_name: 'Sam Lee', recipient_email: 'sam@example.com', message: 'Happy birthday' } }],
      coupon_code: null,
      shipping_method: 'express',
      country: 'Germany',
      gift_card_code: 'ABCD-EFGH IJKL MNOP',
    })
    const cart = await response.json()
    expect(cart.lines[0]).toMatchObject({ productType: 'gift_card', giftCard: { amount: 50, recipientName: 'Sam Lee', recipientEmail: 'sam@example.com', message: 'Happy birthday' } })
    expect(cart.shippingOptions).toEqual([{ id: 'express', label: 'Express', eta: '1–2 days', price: 9.5 }])
    expect(cart).toMatchObject({ requiresShipping: true, shippingError: null, giftCardError: null, giftCard: { last4: 'ABCD', applied: 24.99, balance: 80, remaining: 55.01, expiresAt: null } })
    expect(cart.totals).toMatchObject({ total: 59.5, giftCard: 24.99, amountDue: 34.51 })
  })

  it('a cart of gift cards only: shippingMethod null goes as null, and the answer says no shipping is needed', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/cart/validate': { body: { data: { ...QUOTE, shipping_options: [], shipping_method: null, shipping_required: false, gift_card: null } } } })
    const cart = await (await call('shop/cart/validate', { method: 'POST', body: { items: [{ productId: 30, quantity: 1 }], shippingMethod: null } })).json()
    expect(calls[0].body.shipping_method).toBeNull()
    expect(cart).toMatchObject({ requiresShipping: false, shippingOptions: [], giftCard: null })
  })

  it('places an order with the gift card code; a gift-card-only order has no shipping method', async () => {
    const order = {
      number: 'BN-100009', status: 'processing', payment_status: 'paid', payment_method: 'gift_card', shipping_method: { id: 'none', label: 'No shipping needed', eta: null },
      email: 'ava@example.com', items: [GIFT_LINE], totals: QUOTE.totals, placed_at: '2026-11-17T10:00:00Z',
      gift_card: { last4: 'ABCD', amount: '59.50' }, payment: { provider: 'gift_card', paid_at: '2026-11-17T10:00:00Z', url: null, expires_at: null, can_pay: false },
    }
    const calls = fakeUpstream({ 'POST /api/v1/orders': { status: 201, body: { data: order } } })
    const response = await call('shop/orders', {
      method: 'POST',
      body: { items: [{ productId: 30, quantity: 1, giftCard: { amount: 50, recipientName: 'Sam', recipientEmail: 'sam@example.com' } }], shippingMethod: null, paymentMethod: 'gift_card', giftCardCode: 'ABCDEFGHIJKLMNOP', email: 'ava@example.com' },
    })
    expect(response.status).toBe(201)
    expect(calls[0].body).toMatchObject({ shipping_method: null, payment_method: 'gift_card', gift_card_code: 'ABCDEFGHIJKLMNOP' })
    const placed = await response.json()
    expect(placed).toMatchObject({ requiresShipping: false, shippingMethod: null, paymentProvider: 'gift_card', giftCard: { last4: 'ABCD', applied: 59.5 } })
    expect(placed.items[0].giftCard.recipientName).toBe('Sam Lee')
  })

  it('a gift card code that cannot be a code is not sent at all', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/cart/validate': { body: { data: QUOTE } } })
    await call('shop/cart/validate', { method: 'POST', body: { items: [], giftCardCode: '<script>' } })
    expect(calls[0].body).not.toHaveProperty('gift_card_code')
  })
})

describe('invoice PDFs (/api/shop/orders/:number/invoices/:invoice.pdf)', () => {
  const PDF = '%PDF-1.7\n% fake pdf bytes\n'
  const pdfRoute = { raw: PDF, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="INV-100001.pdf"', 'Content-Length': String(PDF.length) } }

  it('customer: streams the API’s PDF with its type, size, and file name; the token goes along', async () => {
    const calls = fakeUpstream({ 'GET /api/v1/orders/BN-100001/invoices/INV-100001.pdf': pdfRoute })
    const response = await call('shop/orders/BN-100001/invoices/INV-100001.pdf', { cookie: SIGNED_IN })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="INV-100001.pdf"')
    expect(response.headers.get('content-length')).toBe(String(PDF.length))
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).toBe(PDF)
    expect(calls[0].init.headers.Authorization).toBe('Bearer AT')
    expect(calls[0].search).toBe('')
  })

  it('guest: POST with the order’s email, sent to the API in a header (never in the address, which logs keep)', async () => {
    const calls = fakeUpstream({ 'GET /api/v1/orders/BN-100001/invoices/INV-100001.pdf': pdfRoute })
    const response = await call('shop/orders/BN-100001/invoices/INV-100001.pdf', { method: 'POST', body: { email: ' ava@example.com ' } })
    expect(response.status).toBe(200)
    expect(calls[0].search).toBe('')
    expect(calls[0].init.headers['X-Order-Email']).toBe('ava@example.com')
    expect(calls[0].init.headers.Authorization).toBeUndefined()
  })

  it('errors come back as JSON; GET needs a session; a bad file name falls back to the invoice number', async () => {
    fakeUpstream({ 'GET /api/v1/orders/BN-100001/invoices/INV-100001.pdf': { status: 404, body: { message: "We couldn't find an order with that number and email." } } })
    const missing = await call('shop/orders/BN-100001/invoices/INV-100001.pdf', { method: 'POST', body: { email: 'x@example.com' } })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ message: "We couldn't find an order with that number and email." })

    const calls = fakeUpstream({})
    expect((await call('shop/orders/BN-100001/invoices/INV-100001.pdf')).status).toBe(401)
    expect((await call('shop/orders/BN-100001/invoices/INV-100001.pdf', { method: 'POST', body: {} })).status).toBe(401)
    expect((await call('shop/orders/BN-100001/invoices/INV-1.pdf.exe', { cookie: SIGNED_IN })).status).toBe(404)
    expect(calls).toEqual([])

    fakeUpstream({ 'GET /api/v1/orders/BN-100001/invoices/INV-100001.pdf': { ...pdfRoute, headers: { ...pdfRoute.headers, 'Content-Disposition': 'attachment; filename="../../etc/passwd"' } } })
    const renamed = await call('shop/orders/BN-100001/invoices/INV-100001.pdf', { cookie: SIGNED_IN })
    expect(renamed.headers.get('content-disposition')).toBe('attachment; filename="INV-100001.pdf"')
  })
})

describe('PayPal', () => {
  const PAID = { number: 'BN-100002', status: 'processing', payment_status: 'paid', payment_method: 'paypal', email: 'ava@example.com', items: [], totals: QUOTE.totals, placed_at: '2026-11-17T10:00:00Z', payment: { provider: 'paypal', paid_at: '2026-11-17T10:05:00Z', url: null, expires_at: null, can_pay: false, reference: 'CAPTURE-1', dashboard_url: 'https://www.sandbox.paypal.com/x' } }

  it('capture: forwards the token (and a guest’s email) and answers with the order, without staff-only keys', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/orders/BN-100002/paypal/capture': { body: { data: PAID, result: 'paid' } } })
    const response = await call('shop/orders/BN-100002/paypal/capture', { method: 'POST', body: { token: '5O190127TN364715T', email: 'ava@example.com' } })
    expect(response.status).toBe(200)
    expect(calls[0].body).toEqual({ token: '5O190127TN364715T', email: 'ava@example.com' })
    const order = await response.json()
    expect(order).toMatchObject({ paymentStatus: 'paid', paymentProvider: 'paypal' })
    expect(order.payment).not.toHaveProperty('reference')
    expect(order.payment).not.toHaveProperty('dashboardUrl')

    // Signed in: the token proves it; an email in the body is ignored.
    await call('shop/orders/BN-100002/paypal/capture', { method: 'POST', cookie: SIGNED_IN, body: { token: '5O190127TN364715T', email: 'someone@example.com' } })
    expect(calls[1].body).toEqual({ token: '5O190127TN364715T' })
    expect(calls[1].init.headers.Authorization).toBe('Bearer AT')
  })

  it('capture: a malformed token is refused without calling the API; PayPal’s refusal comes back as 422', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/orders/BN-100002/paypal/capture': { status: 422, body: { message: 'PayPal declined the payment: INSTRUMENT_DECLINED. You can try again with Pay now.', errors: { payment: ['…'] } } } })
    const bad = await call('shop/orders/BN-100002/paypal/capture', { method: 'POST', body: { token: '"><script>' } })
    expect(bad.status).toBe(422)
    expect(calls).toEqual([])
    const declined = await call('shop/orders/BN-100002/paypal/capture', { method: 'POST', body: { token: '5O190127TN364715T', email: 'ava@example.com' } })
    expect(declined.status).toBe(422)
    expect((await declined.json()).message).toMatch(/PayPal declined the payment/)
  })

  it('webhook: forwards the exact bytes and PayPal’s five headers with the shared key, and passes the status through', async () => {
    const RAW = '{"id":"WH-1",  "event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"custom_id":"BN-100002","note":"café ✓"}}\n'
    const headers = Object.fromEntries(PAYPAL_HEADERS.map((name, index) => [name, `value-${index}`]))
    const calls = fakeUpstream({ 'POST /api/v1/payments/paypal/webhook': { body: { received: true, result: 'paid' } } })
    const response = await handleApiRequest(
      new Request(`${SITE}/api/payments/paypal/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BuyNest-Bff': 'forged', 'Sec-Fetch-Site': 'cross-site', ...headers }, body: RAW }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true })
    const sent = calls[0].init
    expect(Buffer.from(sent.body).equals(Buffer.from(RAW, 'utf8'))).toBe(true)
    for (const name of PAYPAL_HEADERS) expect(sent.headers[name]).toBe(headers[name])
    expect(sent.headers['X-BuyNest-Bff']).toBe('shared-key')
  })

  it('webhook: refuses without its headers (400), and passes a bad signature back', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/payments/paypal/webhook': { status: 400, body: { message: 'Invalid PayPal signature.' } } })
    const missing = await handleApiRequest(new Request(`${SITE}/api/payments/paypal/webhook`, { method: 'POST', body: '{}' }))
    expect(missing.status).toBe(400)
    expect(calls).toEqual([])
    const headers = Object.fromEntries(PAYPAL_HEADERS.map((name) => [name, 'x']))
    const bad = await handleApiRequest(new Request(`${SITE}/api/payments/paypal/webhook`, { method: 'POST', headers, body: '{}' }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ message: 'Invalid PayPal signature.' })
  })
})

describe('gift card balance (POST /api/shop/gift-cards/check)', () => {
  it('sends the code, upper-cased, and answers with the balance only', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/gift-cards/check': { body: { data: { last4: 'MNOP', balance: '42.50', currency: 'USD', expires_at: '2027-11-17T00:00:00Z', status: 'active' } } } })
    const response = await call('shop/gift-cards/check', { method: 'POST', body: { code: 'abcd-efgh-ijkl-mnop' } })
    expect(calls[0].body).toEqual({ code: 'ABCD-EFGH-IJKL-MNOP' })
    expect(await response.json()).toEqual({ balance: 42.5, currency: 'USD', expiresAt: '2027-11-17T00:00:00Z', status: 'active' })
  })

  it('the same 422 for unknown codes; nothing sent for an empty code', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/gift-cards/check': { status: 422, body: { message: "This gift card code isn't valid.", errors: { code: ["This gift card code isn't valid."] } } } })
    const unknown = await call('shop/gift-cards/check', { method: 'POST', body: { code: 'AAAABBBBCCCCDDDD' } })
    expect(unknown.status).toBe(422)
    expect(await unknown.json()).toEqual({ message: "This gift card code isn't valid.", errors: { code: ["This gift card code isn't valid."] } })
    expect((await call('shop/gift-cards/check', { method: 'POST', body: { code: ' ' } })).status).toBe(422)
    expect(calls).toHaveLength(1)
  })
})

describe('Content-Security-Policy (vite.config.js)', () => {
  it('is unchanged without VITE_ANALYTICS=ga4', () => {
    const policy = buildContentSecurityPolicy({ apiOrigin: 'https://api.example' })
    expect(policy).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://cdn.dummyjson.com https://api.example; connect-src 'self' https://api.example; object-src 'none'; base-uri 'self'; form-action 'self'",
    )
    expect(buildContentSecurityPolicy({ analytics: 'yes' })).not.toMatch(/googletagmanager|analytics/)
  })

  it('allows Google’s tag script and endpoints with VITE_ANALYTICS=ga4', () => {
    const directives = Object.fromEntries(buildContentSecurityPolicy({ analytics: 'ga4' }).split('; ').map((directive) => [directive.split(' ')[0], directive]))
    expect(directives['script-src']).toBe("script-src 'self' https://www.googletagmanager.com")
    expect(directives['connect-src']).toContain('https://*.google-analytics.com')
    expect(directives['connect-src']).toContain('https://*.analytics.google.com')
    expect(directives['img-src']).toContain('https://*.google-analytics.com')
    expect(directives['default-src']).toBe("default-src 'self'")
  })
})
