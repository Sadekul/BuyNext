// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { MAX_SSLCOMMERZ_BYTES } from './paymentsApi'

// Phase 12 (docs/backend/PHASE12_CONTRACT.md §1, §3): SSLCommerz's return trip and IPN, and the
// order's currency and SSLCommerz payment fields on the storefront's orders.
const SITE = 'https://shop.example'

/** Fakes the Laravel API: "METHOD /path" → { status, body } (or a function of the call). Records each call. */
function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname } = new URL(url)
    calls.push({ path: pathname, init })
    const found = routes[`${init.method ?? 'GET'} ${pathname}`]
    const route = (typeof found === 'function' ? found(init) : found) ?? { status: 404, body: { message: 'Not found' } }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

const request = (path, { method = 'POST', headers = {}, body } = {}) => handleApiRequest(new Request(`${SITE}${path}`, { method, headers, body }))
// What SSLCommerz's page posts back from the shopper's browser: a cross-site form POST, no cookies.
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', Origin: 'https://sandbox.sslcommerz.com' }
const posted = (fields) => new URLSearchParams(fields).toString()
const SUCCESS = {
  tran_id: 'BN-100001-1', val_id: '2311191200001aBcDeFgH', amount: '2320.00', card_type: 'BKASH-BKash', store_amount: '2262.00', bank_tran_id: '231119120000ABC',
  status: 'VALID', tran_date: '2026-11-19 12:00:00', currency: 'BDT', value_a: 'BN-100001', verify_sign: 'abc', verify_key: 'amount,bank_tran_id',
}
const RETURN = 'POST /api/v1/payments/sslcommerz/return'
const answer = (confirmation, result, orderNumber = 'BN-100001') => ({ body: { data: { order_number: orderNumber, result, confirmation } } })

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

describe('SSLCommerz return trip (POST /api/payments/sslcommerz/return/:result)', () => {
  it('a cross-site POST without any cookie is forwarded with the shared key and answered 303 to the confirmation page', async () => {
    const calls = fakeLaravel({ [RETURN]: answer('success', 'paid') })
    const response = await request('/api/payments/sslcommerz/return/success', { headers: { ...FORM, 'X-Real-IP': '103.26.139.87' }, body: posted(SUCCESS) })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/order-confirmation/BN-100001?payment=success&provider=sslcommerz')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(calls).toHaveLength(1)
    const sent = calls[0].init
    // Only the fields the API needs; never the posted amount, card type, or status as facts (the API validates val_id).
    expect(JSON.parse(sent.body)).toEqual({ result: 'success', tran_id: 'BN-100001-1', val_id: '2311191200001aBcDeFgH', status: 'VALID', value_a: 'BN-100001' })
    expect(sent.headers['X-BuyNest-Bff']).toBe('shared-secret')
    expect(sent.headers['X-Client-IP']).toBe('103.26.139.87')
    expect(sent.headers.Authorization).toBeUndefined()
  })

  it('a session cookie, if a browser sends one, is never used', async () => {
    const calls = fakeLaravel({ [RETURN]: answer('success', 'paid') })
    await request('/api/payments/sslcommerz/return/success', { headers: { ...FORM, Cookie: 'buynest_at=1|TOKEN; buynest_admin_at=A|ADMIN' }, body: posted(SUCCESS) })
    expect(calls[0].init.headers.Authorization).toBeUndefined()
    expect(JSON.stringify(calls[0].init)).not.toMatch(/TOKEN|ADMIN/)
  })

  it('fail and cancel go to "failed" and "cancelled"; the API’s verdict wins over the posted status', async () => {
    fakeLaravel({ [RETURN]: (init) => answer(JSON.parse(init.body).result === 'fail' ? 'failed' : 'cancelled', 'failed') })
    const failed = await request('/api/payments/sslcommerz/return/fail', { headers: FORM, body: posted({ tran_id: 'BN-100001-2', status: 'FAILED', value_a: 'BN-100001' }) })
    expect(failed.headers.get('location')).toBe('/order-confirmation/BN-100001?payment=failed&provider=sslcommerz')
    const cancelled = await request('/api/payments/sslcommerz/return/cancel', { headers: FORM, body: posted({ tran_id: 'BN-100001-2', status: 'CANCELLED' }) })
    expect(cancelled.headers.get('location')).toBe('/order-confirmation/BN-100001?payment=cancelled&provider=sslcommerz')

    // "success" posted, but the validation said otherwise (amount mismatch): failed.
    fakeLaravel({ [RETURN]: answer('failed', 'mismatch') })
    const mismatch = await request('/api/payments/sslcommerz/return/success', { headers: FORM, body: posted(SUCCESS) })
    expect(mismatch.headers.get('location')).toBe('/order-confirmation/BN-100001?payment=failed&provider=sslcommerz')
  })

  it('without the order number in the answer, it comes from value_a or the tran_id; an unknown order goes home', async () => {
    fakeLaravel({ [RETURN]: answer('success', 'pending', null) })
    const fromTranId = await request('/api/payments/sslcommerz/return/success', { headers: FORM, body: posted({ tran_id: 'BN-100042-3', val_id: 'v1', status: 'VALID' }) })
    expect(fromTranId.headers.get('location')).toBe('/order-confirmation/BN-100042?payment=success&provider=sslcommerz')

    fakeLaravel({ [RETURN]: answer('failed', 'unknown_order', null) })
    const unknown = await request('/api/payments/sslcommerz/return/success', { headers: FORM, body: posted({ tran_id: 'XX-1', val_id: 'v1', status: 'VALID' }) })
    expect(unknown.status).toBe(303)
    expect(unknown.headers.get('location')).toBe('/')
  })

  it('the API unreachable: still 303 (the page polls, the IPN settles it); a refused (422) success → failed', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    const down = await request('/api/payments/sslcommerz/return/success', { headers: FORM, body: posted(SUCCESS) })
    expect(down.status).toBe(303)
    expect(down.headers.get('location')).toBe('/order-confirmation/BN-100001?payment=success&provider=sslcommerz')

    fakeLaravel({ [RETURN]: { status: 422, body: { message: 'The tran id field is required.', errors: { tran_id: ['…'] } } } })
    const refused = await request('/api/payments/sslcommerz/return/success', { headers: FORM, body: posted({ value_a: 'BN-100001', status: 'VALID' }) })
    expect(refused.headers.get('location')).toBe('/order-confirmation/BN-100001?payment=failed&provider=sslcommerz')
  })

  it('malformed fields are dropped (nothing to forward → no API call); only an order number can be redirected to', async () => {
    const calls = fakeLaravel({})
    const response = await request('/api/payments/sslcommerz/return/cancel', {
      headers: FORM,
      body: posted({ tran_id: '../../admin?x=1', value_a: '/evil.example', val_id: '<script>' }),
    })
    expect(calls).toEqual([])
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
  })

  it('reads a multipart form too', async () => {
    const calls = fakeLaravel({ [RETURN]: answer('success', 'paid') })
    const form = new FormData()
    for (const [name, value] of Object.entries(SUCCESS)) form.append(name, value)
    const response = await handleApiRequest(new Request(`${SITE}/api/payments/sslcommerz/return/success`, { method: 'POST', body: form }))
    expect(response.status).toBe(303)
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ tran_id: 'BN-100001-1', val_id: '2311191200001aBcDeFgH' })
  })

  it('refuses other results, other methods, and oversized bodies without calling the API', async () => {
    const calls = fakeLaravel({})
    expect((await request('/api/payments/sslcommerz/return/maybe', { headers: FORM, body: posted(SUCCESS) })).status).toBe(404)
    const get = await request('/api/payments/sslcommerz/return/success', { method: 'GET' })
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
    expect((await request('/api/payments/sslcommerz/return/success', { headers: FORM, body: 'x'.repeat(MAX_SSLCOMMERZ_BYTES + 1) })).status).toBe(413)
    expect(calls).toEqual([])
  })
})

describe('SSLCommerz IPN (POST /api/payments/sslcommerz/ipn)', () => {
  // Non-ASCII and odd ordering: the raw bytes must reach the API unchanged (verify_sign covers them).
  const RAW = 'tran_id=BN-100001-1&val_id=2311191200001aBcDeFgH&amount=2320.00&status=VALID&card_issuer=Dutch%20Bangla%20%E0%A7%B3&value_a=BN-100001&verify_sign=abc&verify_key=amount%2Cstatus'

  it('forwards the exact bytes and content type with the shared key; the API’s answer comes back', async () => {
    const calls = fakeLaravel({ 'POST /api/v1/payments/sslcommerz/ipn': { status: 200, body: { received: true, result: 'paid' } } })
    const response = await request('/api/payments/sslcommerz/ipn', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'buynest_at=1|TOKEN', 'X-BuyNest-Bff': 'forged' }, body: RAW })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true })
    const sent = calls[0].init
    expect(Buffer.from(sent.body).equals(Buffer.from(RAW, 'utf8'))).toBe(true)
    expect(sent.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(sent.headers['X-BuyNest-Bff']).toBe('shared-secret')
    expect(sent.headers.Authorization).toBeUndefined()
  })

  it('passes refusals (400) and "try again" (503) through, so SSLCommerz retries; 502 when the API is down', async () => {
    fakeLaravel({ 'POST /api/v1/payments/sslcommerz/ipn': { status: 400, body: { message: 'Invalid SSLCommerz notification.' } } })
    const bad = await request('/api/payments/sslcommerz/ipn', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'status=VALID' })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ message: 'Invalid SSLCommerz notification.' })
    fakeLaravel({ 'POST /api/v1/payments/sslcommerz/ipn': { status: 503, body: { message: 'SSLCommerz could not be reached.' } } })
    expect((await request('/api/payments/sslcommerz/ipn', { body: RAW })).status).toBe(503)
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    expect((await request('/api/payments/sslcommerz/ipn', { body: RAW })).status).toBe(502)
  })

  it('refuses other methods and oversized bodies', async () => {
    const calls = fakeLaravel({})
    expect((await request('/api/payments/sslcommerz/ipn', { method: 'GET' })).status).toBe(405)
    expect((await request('/api/payments/sslcommerz/ipn', { body: 'x'.repeat(MAX_SSLCOMMERZ_BYTES + 1) })).status).toBe(413)
    expect(calls).toEqual([])
  })
})

describe('orders in their own currency, paid through SSLCommerz (shop)', () => {
  const shop = (path, { method = 'POST', body, cookie } = {}) =>
    request(`/api/shop/${path}`, { method, headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }) }, body: body && JSON.stringify(body) })
  const ORDER = {
    number: 'BN-100001', status: 'pending_payment', payment_status: 'unpaid', payment_method: 'sslcommerz', currency: 'BDT', shipping_method: { id: 'standard', label: 'Standard', eta: '3–5 days' },
    email: 'rahim@example.com', phone: '+8801711000000', items: [], totals: { item_count: 0, subtotal: '2200.00', discount: '0.00', shipping: '120.00', tax: '0.00', total: '2320.00' },
    placed_at: '2026-11-19T10:00:00Z', invoices: [{ number: 'INV-1', amount: '2320.00', created_at: '2026-11-19T10:05:00Z', currency: 'BDT' }],
    payment: { provider: 'sslcommerz', url: 'https://sandbox.sslcommerz.com/EasyCheckOut/testcde', expires_at: '2026-11-19T13:00:00Z', paid_at: null, can_pay: true, method_label: null },
  }

  it('a placed SSLCommerz order carries the GatewayPageURL and the order currency; staff-only keys stay out', async () => {
    fakeLaravel({ 'POST /api/v1/orders': { status: 201, body: { data: { ...ORDER, payment: { ...ORDER.payment, reference: '231119ABC', sslcommerz: { val_id: 'v', bank_tran_id: 'b' } } } } } })
    const order = await (await shop('orders', { body: { items: [], paymentMethod: 'sslcommerz' } })).json()
    expect(order).toMatchObject({ currency: 'BDT', paymentProvider: 'sslcommerz', canPay: true, totals: { total: 2320 } })
    expect(order.payment).toEqual({ provider: 'sslcommerz', url: 'https://sandbox.sslcommerz.com/EasyCheckOut/testcde', expiresAt: '2026-11-19T13:00:00Z', paidAt: null, canPay: true })
    expect(order.invoices[0]).toEqual({ number: 'INV-1', amount: 2320, createdAt: '2026-11-19T10:05:00Z', currency: 'BDT' })
    expect(JSON.stringify(order)).not.toMatch(/231119ABC|bank_tran_id|val_id/)
  })

  it('a paid order names how (method_label, card_type); a bad currency is dropped', async () => {
    fakeLaravel({
      'GET /api/v1/orders/BN-100001': {
        body: { data: { ...ORDER, currency: 'taka', payment_status: 'paid', payment: { ...ORDER.payment, url: null, paid_at: '2026-11-19T10:05:00Z', can_pay: false, method_label: 'bKash', card_type: 'BKASH-BKash' } } },
      },
    })
    const order = await (await shop('orders/BN-100001', { method: 'GET', cookie: 'buynest_at=1|ACCESS' })).json()
    expect(order.currency).toBeUndefined()
    expect(order.payment).toMatchObject({ methodLabel: 'bKash', cardType: 'BKASH-BKash', paidAt: '2026-11-19T10:05:00Z' })
  })

  it('the store settings pass currency, paypal_payments and sslcommerz_payments on', async () => {
    fakeLaravel({ 'GET /api/v1/store': { body: { data: { currency: { code: 'BDT', symbol: '৳', decimals: 2 }, paypal_payments: 'unavailable', sslcommerz_payments: 'sslcommerz' } } } })
    const response = await request('/api/catalog/store', { method: 'GET', headers: { 'Sec-Fetch-Site': 'same-origin' } })
    expect((await response.json()).data).toMatchObject({ currency: { code: 'BDT', symbol: '৳' }, paypal_payments: 'unavailable', sslcommerz_payments: 'sslcommerz' })
  })
})
