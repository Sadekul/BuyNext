// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { mediaPath } from './mediaApi'
import { MAX_BODY_BYTES, PER_VISITOR, resetClientErrorLimits, scrub, toReport } from './clientErrorsApi'

/*
 * Phase 9 storefront services: browser error reports (/api/client-errors),
 * change email, my data, delete my account, stock alerts, cancel my order
 * (/api/shop), and the resized photos' names (/media).
 */

const SITE = 'https://shop.example'

/** Fakes the Laravel API: `routes` maps "METHOD /path" to { status, body, headers }. Records each call. */
function fakeUpstream(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname } = new URL(url)
    calls.push({ path: pathname, init, body: init.body ? JSON.parse(init.body) : undefined })
    const route = routes[`${init.method ?? 'GET'} ${pathname}`] ?? { status: 404, body: { message: 'Not found' } }
    if (route.status === 204) return new Response(null, { status: 204 })
    const headers = { 'Content-Type': 'application/json', ...route.headers }
    return new Response(typeof route.raw === 'string' ? route.raw : JSON.stringify(route.body), { status: route.status ?? 200, headers })
  })
  return calls
}

const call = (path, { method = 'GET', body, cookie, ip = '203.0.113.7', headers = {} } = {}) =>
  handleApiRequest(
    new Request(`${SITE}/api/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'X-Real-IP': ip, ...(cookie && { Cookie: cookie }), ...headers },
      body: typeof body === 'string' ? body : body && JSON.stringify(body),
    }),
  )
const SIGNED_IN = 'buynest_at=AT'

beforeEach(() => {
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
  vi.stubEnv('BUYNEST_BFF_KEY', 'shared-key')
  resetClientErrorLimits()
})
afterEach(() => vi.unstubAllEnvs())

describe('browser error reports (POST /api/client-errors)', () => {
  const REPORT = { message: 'Cannot read properties of undefined', stack: 'TypeError: x\n    at Card (https://shop.example/assets/index.js?v=1:1:2)', url: '/products/5?q=secret#top', app: 'store', release: '2026.11.17' }

  it('forwards only the five fields, with the path only and the shared key, and answers 202', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/client-errors': { status: 202, body: { data: { received: true, duplicate: false } } } })
    const response = await call('client-errors', { method: 'POST', body: { ...REPORT, cookie: 'buynest_at=AT', formValues: { card: '4242' } } })
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0].path).toBe('/api/v1/client-errors')
    expect(calls[0].body).toEqual({
      message: 'Cannot read properties of undefined',
      stack: "TypeError: x\n    at Card (https://shop.example/assets/index.js:1:2)",
      url: '/products/5',
      app: 'store',
      release: '2026.11.17',
    })
    expect(calls[0].init.headers['X-BuyNest-Bff']).toBe('shared-key')
    expect(calls[0].init.headers['X-Client-IP']).toBe('203.0.113.7')
    expect(calls[0].init.headers.Authorization).toBeUndefined() // never the customer's token
  })

  it('accepts the admin app and a text/plain body (sendBeacon)', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/client-errors': { status: 202, body: {} } })
    const response = await call('client-errors', { method: 'POST', body: JSON.stringify({ ...REPORT, app: 'admin' }), headers: { 'Content-Type': 'text/plain;charset=UTF-8' } })
    expect(response.status).toBe(202)
    expect(calls[0].body.app).toBe('admin')
  })

  it('refuses reports that are too big, unreadable, from an unknown app, or from another website', async () => {
    const calls = fakeUpstream({})
    expect((await call('client-errors', { method: 'POST', body: { ...REPORT, stack: 'x'.repeat(MAX_BODY_BYTES) } })).status).toBe(413)
    expect((await call('client-errors', { method: 'POST', body: 'not json' })).status).toBe(400)
    expect((await call('client-errors', { method: 'POST', body: { ...REPORT, app: 'other' } })).status).toBe(422)
    expect((await call('client-errors', { method: 'POST', body: { ...REPORT, message: '  ' } })).status).toBe(422)
    expect((await call('client-errors', { method: 'POST', body: REPORT, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403)
    expect((await call('client-errors', { method: 'GET' })).status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('caps the stack at 8 KB and the message at 1,000 characters, and masks emails and card numbers', () => {
    const report = toReport({ message: `Failed for jane@example.com card 4242 4242 4242 4242 ${'m'.repeat(2000)}`, stack: 'é'.repeat(9000), url: 'https://shop.example/a/b?token=1', app: 'store' })
    expect(report.message.startsWith('Failed for [email] card [number] ')).toBe(true)
    expect(report.message).toHaveLength(1000)
    expect(new TextEncoder().encode(report.stack).length).toBeLessThanOrEqual(8192)
    expect(report.url).toBe('/a/b')
    expect(report.release).toBeNull()
    expect(scrub('see https://x.test/p?email=a@b.co#f')).toBe('see https://x.test/p')
  })

  it('drops the same report within a minute and more than 10 a minute per visitor (still 202)', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/client-errors': { status: 202, body: {} } })
    await call('client-errors', { method: 'POST', body: REPORT })
    expect((await call('client-errors', { method: 'POST', body: REPORT })).status).toBe(202)
    expect(calls).toHaveLength(1)
    for (let index = 0; index < PER_VISITOR + 3; index += 1) {
      expect((await call('client-errors', { method: 'POST', body: { ...REPORT, message: `Error ${index}` } })).status).toBe(202)
    }
    expect(calls).toHaveLength(PER_VISITOR)
    // Another visitor isn't affected.
    await call('client-errors', { method: 'POST', body: REPORT, ip: '198.51.100.2' })
    expect(calls).toHaveLength(PER_VISITOR + 1)
  })

  it('answers 202 even when the API refuses or is down', async () => {
    fakeUpstream({ 'POST /api/v1/client-errors': { status: 403, body: { code: 'store_only' } } })
    expect((await call('client-errors', { method: 'POST', body: REPORT })).status).toBe(202)
  })
})

const API_CUSTOMER = { id: 5, first_name: 'Nadia', last_name: 'Rahman', email: 'new@example.com', phone: '+8801712345678', email_verified: true, pending_email: null, newsletter: false }

describe('change email (/api/shop/me/email)', () => {
  it('needs the customer session', async () => {
    const calls = fakeUpstream({})
    for (const path of ['me/email', 'me/email/confirm', 'me/delete']) expect((await call(`shop/${path}`, { method: 'POST', body: {} })).status).toBe(401)
    expect((await call('shop/me/export')).status).toBe(401)
    expect((await call('shop/me/stock-alerts')).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('asks for a code for the new address, sending only the email and password', async () => {
    const calls = fakeUpstream({
      'POST /api/v1/me/email': { body: { message: 'We emailed a 6-digit code to new@example.com.', data: { email: 'new@example.com', expires_in: 600, resend_in: 60 } } },
    })
    const response = await call('shop/me/email', { method: 'POST', cookie: SIGNED_IN, body: { email: ' new@example.com ', password: 'Secret123', id: 9 } })
    expect(await response.json()).toEqual({ email: 'new@example.com', expiresIn: 600, resendIn: 60, message: 'We emailed a 6-digit code to new@example.com.' })
    expect(calls[0].body).toEqual({ email: 'new@example.com', password: 'Secret123' })
    expect(calls[0].init.headers.Authorization).toBe('Bearer AT')
  })

  it('passes 422 field errors on', async () => {
    fakeUpstream({ 'POST /api/v1/me/email': { status: 422, body: { message: 'Your password is incorrect.', errors: { password: ['Your password is incorrect.'] } } } })
    const response = await call('shop/me/email', { method: 'POST', cookie: SIGNED_IN, body: { email: 'new@example.com', password: 'x' } })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ message: 'Your password is incorrect.', errors: { password: ['Your password is incorrect.'] } })
  })

  it('confirms with the code and answers with the profile', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/me/email/confirm': { body: { message: 'Your email is now new@example.com.', data: API_CUSTOMER } } })
    const response = await call('shop/me/email/confirm', { method: 'POST', cookie: SIGNED_IN, body: { code: '123 456' } })
    expect(await response.json()).toEqual({ id: 5, firstName: 'Nadia', lastName: 'Rahman', email: 'new@example.com', phone: '+8801712345678', emailVerified: true, role: 'customer', newsletter: false })
    expect(calls[0].body).toEqual({ code: '123456' })
  })
})

describe('my data and deleting my account', () => {
  it('passes the export file through as an attachment, unchanged', async () => {
    const file = '{\n  "profile": { "email": "nadia@example.com" }\n}'
    fakeUpstream({ 'GET /api/v1/me/export': { raw: file, headers: { 'Content-Disposition': 'attachment; filename="buynest-my-data-2026-11-17.json"' } } })
    const response = await call('shop/me/export', { cookie: SIGNED_IN })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="buynest-my-data-2026-11-17.json"')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe(file)
  })

  it('passes the export rate limit on as JSON', async () => {
    fakeUpstream({ 'GET /api/v1/me/export': { status: 429, body: { message: 'Too Many Attempts.' } } })
    const response = await call('shop/me/export', { cookie: SIGNED_IN })
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ message: 'Too Many Attempts.' })
  })

  it('deletes the account with the password and DELETE, and ends the session', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/me/delete': { body: { message: 'Your account was deleted.' } } })
    const response = await call('shop/me/delete', { method: 'POST', cookie: SIGNED_IN, body: { password: 'Secret123', confirm: 'DELETE', reason: 'x' } })
    expect(await response.json()).toEqual({ message: 'Your account was deleted.' })
    expect(calls[0].body).toEqual({ password: 'Secret123', confirm: 'DELETE' })
    const cookies = response.headers.getSetCookie()
    expect(cookies.some((cookie) => cookie.startsWith('buynest_at=;') && cookie.includes('Max-Age=0'))).toBe(true)
    expect(cookies.some((cookie) => cookie.startsWith('buynest_session=;'))).toBe(true)
  })

  it('keeps the session when the API refuses (an open order)', async () => {
    const message = "You have 1 open order (pending payment, processing, or shipped). You can delete your account once it's delivered or cancelled."
    fakeUpstream({ 'POST /api/v1/me/delete': { status: 422, body: { message, errors: { account: [message] } } } })
    const response = await call('shop/me/delete', { method: 'POST', cookie: SIGNED_IN, body: { password: 'Secret123', confirm: 'DELETE' } })
    expect(response.status).toBe(422)
    expect((await response.json()).errors.account).toEqual([message])
    expect(response.headers.getSetCookie()).toEqual([])
  })
})

describe('stock alerts', () => {
  const MESSAGE = "Thanks! We'll email you once when it's back in stock."

  it("a guest's alert sends the email and variant; the answer is always 202 with the same message", async () => {
    const calls = fakeUpstream({ 'POST /api/v1/products/12/stock-alerts': { status: 202, body: { data: { message: MESSAGE } } } })
    const response = await call('shop/products/12/stock-alerts', { method: 'POST', body: { email: ' guest@example.com ', variantId: '53', extra: 1 } })
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ message: MESSAGE })
    expect(calls[0].body).toEqual({ email: 'guest@example.com', variant_id: 53 })
    expect(calls[0].init.headers.Authorization).toBeUndefined()
  })

  it('a signed-in customer uses the account (any email sent is dropped)', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/products/12/stock-alerts': { status: 202, body: { data: { message: MESSAGE } } } })
    await call('shop/products/12/stock-alerts', { method: 'POST', cookie: SIGNED_IN, body: { email: 'someone@else.com' } })
    expect(calls[0].body).toEqual({})
    expect(calls[0].init.headers.Authorization).toBe('Bearer AT')
  })

  it("lists and removes the customer's alerts", async () => {
    const calls = fakeUpstream({
      'GET /api/v1/me/stock-alerts': {
        body: { data: [{ id: 3, product: { id: 12, name: 'Classic Tee', thumbnail_url: '/media/products/12/abc.jpg' }, variant_id: 53, variant_label: 'Size: M', created_at: '2026-11-17T10:00:00Z', email: 'x@y.z' }] },
      },
      'DELETE /api/v1/me/stock-alerts/3': { status: 204 },
    })
    const list = await call('shop/me/stock-alerts', { cookie: SIGNED_IN })
    expect(await list.json()).toEqual({
      alerts: [{ id: 3, productId: 12, title: 'Classic Tee', thumbnail: '/media/products/12/abc.jpg', variantId: 53, variantLabel: 'Size: M', createdAt: '2026-11-17T10:00:00Z' }],
    })
    const removed = await call('shop/me/stock-alerts/3', { method: 'DELETE', cookie: SIGNED_IN })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ ok: true })
    expect(calls.map((entry) => entry.path)).toEqual(['/api/v1/me/stock-alerts', '/api/v1/me/stock-alerts/3'])
    expect((await call('shop/me/stock-alerts/abc', { method: 'DELETE', cookie: SIGNED_IN })).status).toBe(404)
  })

  it('stops the alerts from the email link (a malformed token never reaches the API)', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/stock-alerts/unsubscribe': { body: { data: { removed: 2 } } } })
    const response = await call('shop/stock-alerts/unsubscribe', { method: 'POST', body: { token: `7.${'a'.repeat(40)}` } })
    expect((await response.json()).removed).toBe(2)
    expect((await call('shop/stock-alerts/unsubscribe', { method: 'POST', body: { token: '../x' } })).status).toBe(422)
    expect(calls).toHaveLength(1)
  })
})

describe('cancel my order (POST /api/shop/orders/:number/cancel)', () => {
  const ORDER = {
    number: 'BN-100045', status: 'cancelled', payment_status: 'unpaid', payment_method: 'cod', email: 'guest@example.com', phone: '+1',
    shipping_address: { first_name: 'G', last_name: 'U', line1: '1', city: 'C', state: 'S', postal_code: '1', country: 'US' },
    items: [], totals: { subtotal: '10.00', total: '10.00' }, placed_at: '2026-11-17T10:00:00Z', can_cancel: false,
  }

  it('a guest proves the order with its email; the answer is the order with canCancel', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/orders/BN-100045/cancel': { body: { data: ORDER } } })
    const response = await call('shop/orders/BN-100045/cancel', { method: 'POST', body: { email: 'guest@example.com', reason: '  Ordered twice ' } })
    const order = await response.json()
    expect(order.status).toBe('cancelled')
    expect(order.canCancel).toBe(false)
    expect(calls[0].body).toEqual({ email: 'guest@example.com', reason: 'Ordered twice' })
  })

  it('a customer uses the session (no email sent)', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/orders/BN-100045/cancel': { body: { data: ORDER } } })
    await call('shop/orders/BN-100045/cancel', { method: 'POST', cookie: SIGNED_IN, body: { email: 'other@example.com' } })
    expect(calls[0].body).toEqual({})
    expect(calls[0].init.headers.Authorization).toBe('Bearer AT')
  })

  it("passes the API's 422 text on for paid or shipped orders", async () => {
    const message = "This order has been paid or shipped, so it can't be cancelled online. Contact us to cancel it: support@buynest.test"
    fakeUpstream({ 'POST /api/v1/orders/BN-100045/cancel': { status: 422, body: { message, errors: { order: [message] } } } })
    const response = await call('shop/orders/BN-100045/cancel', { method: 'POST', cookie: SIGNED_IN, body: {} })
    expect(response.status).toBe(422)
    expect((await response.json()).message).toBe(message)
  })

  it('orders carry canCancel', async () => {
    fakeUpstream({ 'GET /api/v1/orders/BN-100045': { body: { data: { ...ORDER, status: 'processing', can_cancel: true } } } })
    expect((await (await call('shop/orders/BN-100045', { cookie: SIGNED_IN })).json()).canCancel).toBe(true)
  })
})

describe('/media allow-list (phase 9 resized copies)', () => {
  const hex = 'a'.repeat(32)
  it('allows the original and its -320 / -960 copies only', () => {
    expect(mediaPath(`/media/products/12/${hex}.jpg`)).toBe(`products/12/${hex}.jpg`)
    expect(mediaPath(`/media/products/12/${hex}-320.webp`)).toBe(`products/12/${hex}-320.webp`)
    expect(mediaPath(`/api/media/products/12/${hex}-960.png`)).toBe(`products/12/${hex}-960.png`)
    expect(mediaPath(`/media/products/12/${hex}-640.webp`)).toBeNull()
    expect(mediaPath(`/media/products/12/${hex}-320-960.webp`)).toBeNull()
    expect(mediaPath(`/media/products/12/${hex}-320.gif`)).toBeNull()
  })
})
