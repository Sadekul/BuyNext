// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

/*
 * Phase 19 (docs/backend/PHASE19_CONTRACT.md §3): the welcome coupon's new
 * keys get through the sign-in service (phase 17 lesson: a whitelist silently
 * dropped `has_sales`): GET /store `welcome_offer`, the account's
 * `welcome_coupon`, and the newsletter confirmation's `welcome_coupon_sent`.
 */
const SITE = 'https://shop.example'

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname } = new URL(url)
    calls.push({ path: pathname, init, body: init.body ? JSON.parse(init.body) : undefined })
    const route = routes[`${init.method ?? 'GET'} ${pathname}`] ?? { status: 404, body: { message: 'Not found' } }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}
const call = (path, { method = 'GET', body, cookie } = {}) =>
  handleApiRequest(
    new Request(`${SITE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Origin: SITE, ...(cookie && { Cookie: cookie }) },
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

const OFFER = { type: 'percent', value: '10', label: '10% off', min_subtotal: '500.00', valid_days: 30, first_order_only: true, triggers: ['signup', 'newsletter'] }

describe('GET /api/catalog/store: welcome_offer', () => {
  it('passes the offer on next to the existing keys', async () => {
    fakeLaravel({ 'GET /api/v1/store': { body: { data: { store_name: 'BuyNest', payment_methods: ['cod'], welcome_offer: OFFER } } } })
    const response = await call('/api/catalog/store')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { store_name: 'BuyNest', payment_methods: ['cod'], welcome_offer: OFFER } })
  })

  it('passes null on (the offer is off)', async () => {
    fakeLaravel({ 'GET /api/v1/store': { body: { data: { store_name: 'BuyNest', welcome_offer: null } } } })
    expect((await (await call('/api/catalog/store')).json()).data.welcome_offer).toBeNull()
  })
})

describe('GET /api/auth/me: welcome_coupon', () => {
  const CUSTOMER = { id: 3, first_name: 'Ava', last_name: 'Cole', email: 'ava@example.com', phone: null, email_verified: true, newsletter: true }
  const COUPON = { code: 'WELCOME-AB23CD', label: '10% off', min_subtotal: '500.00', expires_at: '2026-12-26T23:59:59+06:00', status: 'active' }

  it('maps the code to the storefront’s camelCase, documented keys only', async () => {
    fakeLaravel({ 'GET /api/v1/me': { body: { data: { ...CUSTOMER, welcome_coupon: { ...COUPON, first_order_only: true, coupon_id: 9, issued_to_email: 'ava@example.com' } } } } })
    const profile = await (await call('/api/auth/me', { cookie: 'buynest_at=AT' })).json()
    expect(profile.welcomeCoupon).toEqual({ code: 'WELCOME-AB23CD', label: '10% off', minSubtotal: '500.00', expiresAt: '2026-12-26T23:59:59+06:00', status: 'active', firstOrderOnly: true })
  })

  it('keeps used and expired codes, with nulls for what the API leaves out', async () => {
    fakeLaravel({ 'GET /api/v1/me': { body: { data: { ...CUSTOMER, welcome_coupon: { code: 'WELCOME-ZZ99XY', label: '৳100 off', min_subtotal: null, expires_at: null, status: 'used' } } } } })
    expect((await (await call('/api/auth/me', { cookie: 'buynest_at=AT' })).json()).welcomeCoupon).toEqual({ code: 'WELCOME-ZZ99XY', label: '৳100 off', minSubtotal: null, expiresAt: null, status: 'used' })
  })

  it.each([[null], [undefined], [{ code: '<script>' }], [{ status: 'active' }], ['WELCOME-AB23CD']])('leaves it out for %o', async (value) => {
    fakeLaravel({ 'GET /api/v1/me': { body: { data: { ...CUSTOMER, welcome_coupon: value } } } })
    expect(await (await call('/api/auth/me', { cookie: 'buynest_at=AT' })).json()).not.toHaveProperty('welcomeCoupon')
  })

  it('maps it on the profile answer too (switching the newsletter on may issue one)', async () => {
    fakeLaravel({ 'PATCH /api/v1/me': { body: { data: { ...CUSTOMER, welcome_coupon: COUPON } } } })
    const response = await call('/api/auth/profile', { method: 'PUT', cookie: 'buynest_at=AT', body: { newsletter: true } })
    expect((await response.json()).welcomeCoupon).toMatchObject({ code: 'WELCOME-AB23CD', status: 'active' })
  })
})

describe('POST /api/shop/newsletter/confirm: welcome_coupon_sent', () => {
  const answer = (extra) => ({ message: "You're subscribed.", data: { email: 'ava@example.com', status: 'subscribed' }, ...extra })

  it.each([[true], [false]])('passes welcome_coupon_sent: %s on as welcomeCouponSent', async (sent) => {
    fakeLaravel({ 'POST /api/v1/newsletter/confirm': { body: answer({ welcome_coupon_sent: sent }) } })
    expect(await (await call('/api/shop/newsletter/confirm', { method: 'POST', body: { token: 'abc123' } })).json()).toEqual({
      message: "You're subscribed.",
      email: 'ava@example.com',
      status: 'subscribed',
      welcomeCouponSent: sent,
    })
  })

  it('also reads it inside `data`, and leaves it out when the API says nothing', async () => {
    fakeLaravel({ 'POST /api/v1/newsletter/confirm': { body: { message: 'ok', data: { email: 'a@b.co', status: 'subscribed', welcome_coupon_sent: true } } } })
    expect((await (await call('/api/shop/newsletter/confirm', { method: 'POST', body: { token: 'abc123' } })).json()).welcomeCouponSent).toBe(true)
    fakeLaravel({ 'POST /api/v1/newsletter/confirm': { body: answer({ welcome_coupon_sent: 'yes' }) } })
    expect(await (await call('/api/shop/newsletter/confirm', { method: 'POST', body: { token: 'abc123' } })).json()).not.toHaveProperty('welcomeCouponSent')
  })
})
