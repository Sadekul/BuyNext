// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

/*
 * Phase 20 (docs/backend/PHASE20_CONTRACT.md §3): the storefront side of SMS.
 * - /api/shop/order-confirmations/:token: the one-tap link in the cash on delivery
 *   text, no sign-in, the API's status codes and messages passed through.
 * - GET /api/catalog/store passes `sms_updates` on (phase 17 lesson: a whitelist
 *   silently dropped `has_sales`), and the storefront adapter keeps it.
 */
const SITE = 'https://shop.example'
const TOKEN = 'Q2hhbmdlTWUtYS1yYW5kb20tdG9rZW4tMzJieXRlcw'

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname } = new URL(url)
    calls.push({ path: pathname, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined })
    const route = routes[`${init.method ?? 'GET'} ${pathname}`] ?? { status: 404, body: { message: 'Not found' } }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}
const call = (path, { method = 'GET', body, cookie, headers = {} } = {}) =>
  handleApiRequest(
    new Request(`${SITE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Origin: SITE, ...(cookie && { Cookie: cookie }), ...headers },
      body: body && JSON.stringify(body),
    }),
  )

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

const API_PATH = `/api/v1/order-confirmations/${TOKEN}`
const SUMMARY = { number: 'BN-100042', total: '1250.00', items_count: 3, placed_at: '2026-11-27T10:15:00+06:00', status: 'pending' }

describe('GET /api/shop/order-confirmations/:token', () => {
  it('reads the summary without a sign-in, documented keys only, camelCase', async () => {
    const calls = fakeLaravel({ [`GET ${API_PATH}`]: { body: { data: { ...SUMMARY, shipping_address: 'Road 5', phone: '01712345678', customer_name: 'Rahim' } } } })
    const response = await call(`/api/shop/order-confirmations/${TOKEN}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ number: 'BN-100042', total: 1250, itemsCount: 3, placedAt: '2026-11-27T10:15:00+06:00', status: 'pending' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ path: API_PATH, method: 'GET' })
    expect(calls[0].headers).not.toHaveProperty('Authorization')
  })

  it('never sends the customer session, and passes the visitor on for the API rate limit', async () => {
    const calls = fakeLaravel({ [`GET ${API_PATH}`]: { body: { data: SUMMARY } } })
    await call(`/api/shop/order-confirmations/${TOKEN}`, { cookie: 'buynest_at=CUSTOMER-TOKEN; buynest_lang=bn', headers: { 'X-Real-IP': '203.0.113.9' } })
    expect(calls[0].headers).not.toHaveProperty('Authorization')
    expect(calls[0].headers).toMatchObject({ 'X-BuyNest-Bff': 'shared-secret', 'X-Client-IP': '203.0.113.9', 'Accept-Language': 'bn' })
  })

  it.each(['confirmed', 'cancelled', 'expired', 'not_waiting'])('passes the %s status on', async (status) => {
    fakeLaravel({ [`GET ${API_PATH}`]: { body: { data: { ...SUMMARY, status } } } })
    expect((await (await call(`/api/shop/order-confirmations/${TOKEN}`)).json()).status).toBe(status)
  })

  it('an unknown status from the API is shown as "nothing to answer"', async () => {
    fakeLaravel({ [`GET ${API_PATH}`]: { body: { data: { ...SUMMARY, status: 'bogus' } } } })
    expect((await (await call(`/api/shop/order-confirmations/${TOKEN}`)).json()).status).toBe('not_waiting')
  })

  it('passes the API 404 (expired or unknown link) and its message through', async () => {
    fakeLaravel({ [`GET ${API_PATH}`]: { status: 404, body: { message: 'This link has expired.' } } })
    const response = await call(`/api/shop/order-confirmations/${TOKEN}`)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ message: 'This link has expired.' })
  })

  it('passes the throttle (429) through', async () => {
    fakeLaravel({ [`GET ${API_PATH}`]: { status: 429, body: { message: 'Too many attempts. Try again in a minute.' } } })
    const response = await call(`/api/shop/order-confirmations/${TOKEN}`)
    expect(response.status).toBe(429)
    expect((await response.json()).message).toBe('Too many attempts. Try again in a minute.')
  })

  it.each(['short', 'has.dots.in.it.0123456789', 'a'.repeat(129), '%3Cscript%3E0123456789abcdef'])('answers a malformed token (%s) with a plain 404, without asking the API', async (token) => {
    const calls = fakeLaravel({})
    const response = await call(`/api/shop/order-confirmations/${token}`)
    expect(response.status).toBe(404)
    expect((await response.json()).message).toMatch(/isn't valid or has expired/)
    expect(calls).toHaveLength(0)
  })

  it('says it in Bangla for a Bangla shopper', async () => {
    fakeLaravel({})
    const response = await call('/api/shop/order-confirmations/bad', { cookie: 'buynest_lang=bn' })
    expect((await response.json()).message).toMatch(/লিংকটি সঠিক নয়/)
  })

  it('refuses cross-site requests', async () => {
    const calls = fakeLaravel({})
    const response = await call(`/api/shop/order-confirmations/${TOKEN}`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
    expect(response.status).toBe(403)
    expect(calls).toHaveLength(0)
  })
})

describe('POST /api/shop/order-confirmations/:token', () => {
  it('confirms: only the action goes to the API', async () => {
    const calls = fakeLaravel({ [`POST ${API_PATH}`]: { body: { message: 'Order confirmed.', data: { ...SUMMARY, status: 'confirmed' } } } })
    const response = await call(`/api/shop/order-confirmations/${TOKEN}`, { method: 'POST', body: { action: 'confirm', reason: 'ignored', status: 'cancelled', email: 'x@example.com' } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ number: 'BN-100042', total: 1250, itemsCount: 3, placedAt: '2026-11-27T10:15:00+06:00', status: 'confirmed', message: 'Order confirmed.' })
    expect(calls[0]).toMatchObject({ path: API_PATH, method: 'POST', body: { action: 'confirm' } })
    expect(calls[0].headers).not.toHaveProperty('Authorization')
  })

  it('cancels with the optional reason, trimmed and capped', async () => {
    const calls = fakeLaravel({ [`POST ${API_PATH}`]: { body: { data: { ...SUMMARY, status: 'cancelled' } } } })
    const response = await call(`/api/shop/order-confirmations/${TOKEN}`, { method: 'POST', body: { action: 'cancel', reason: `  ${'x'.repeat(600)}  ` } })
    expect(await response.json()).toMatchObject({ status: 'cancelled' })
    expect(calls[0].body).toEqual({ action: 'cancel', reason: 'x'.repeat(500) })
  })

  it('cancels without a reason', async () => {
    const calls = fakeLaravel({ [`POST ${API_PATH}`]: { body: { data: { ...SUMMARY, status: 'cancelled' } } } })
    await call(`/api/shop/order-confirmations/${TOKEN}`, { method: 'POST', body: { action: 'cancel', reason: '   ' } })
    expect(calls[0].body).toEqual({ action: 'cancel' })
  })

  it('passes the API refusal (422: already shipped) with its message and field errors through', async () => {
    fakeLaravel({ [`POST ${API_PATH}`]: { status: 422, body: { message: 'This order has shipped and can no longer be cancelled.', errors: { action: ['This order has shipped.'], secret: ['x'] } } } })
    const response = await call(`/api/shop/order-confirmations/${TOKEN}`, { method: 'POST', body: { action: 'cancel' } })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ message: 'This order has shipped and can no longer be cancelled.', errors: { action: ['This order has shipped.'] } })
  })

  it('passes 404 (used or expired link) and 429 through', async () => {
    fakeLaravel({ [`POST ${API_PATH}`]: { status: 404, body: { message: 'This link has expired.' } } })
    let response = await call(`/api/shop/order-confirmations/${TOKEN}`, { method: 'POST', body: { action: 'confirm' } })
    expect(response.status).toBe(404)
    expect((await response.json()).message).toBe('This link has expired.')
    fakeLaravel({ [`POST ${API_PATH}`]: { status: 429, body: { message: 'Too many attempts.' } } })
    response = await call(`/api/shop/order-confirmations/${TOKEN}`, { method: 'POST', body: { action: 'confirm' } })
    expect(response.status).toBe(429)
  })

  it('leaves an unknown action for the API to refuse', async () => {
    const calls = fakeLaravel({ [`POST ${API_PATH}`]: { status: 422, body: { message: 'The selected action is invalid.', errors: { action: ['The selected action is invalid.'] } } } })
    const response = await call(`/api/shop/order-confirmations/${TOKEN}`, { method: 'POST', body: { action: 'delete' } })
    expect(response.status).toBe(422)
    expect(calls[0].body).toEqual({ action: 'delete' })
  })

  it('no other methods', async () => {
    fakeLaravel({})
    expect((await call(`/api/shop/order-confirmations/${TOKEN}`, { method: 'DELETE' })).status).toBe(404)
    expect((await call(`/api/shop/order-confirmations/${TOKEN}/extra`)).status).toBe(404)
  })
})

describe('GET /api/catalog/store: sms_updates', () => {
  it.each([[true], [false]])('passes sms_updates: %s on next to the existing keys', async (value) => {
    fakeLaravel({ 'GET /api/v1/store': { body: { data: { store_name: 'BuyNest', payment_methods: ['cod'], welcome_offer: null, sms_updates: value } } } })
    const response = await call('/api/catalog/store')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { store_name: 'BuyNest', payment_methods: ['cod'], welcome_offer: null, sms_updates: value } })
  })
})
