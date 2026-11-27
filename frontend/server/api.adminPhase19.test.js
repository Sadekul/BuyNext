// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { validateCoupon } from './adminApi.js'
import { validateWelcomeCoupon } from './adminPhase19Api.js'
import { couponPhase19, toWelcomeBody, welcomeCode, welcomeSettings } from './shop/adminPhase19.js'

/*
 * Phase 19 admin routes and fields (adminPhase19Api.js, shop/adminPhase19.js):
 * the welcome coupon's settings, preview and stats, the codes it issued, and
 * the coupons' new fields and source filter. Laravel is faked; shapes from
 * docs/backend/PHASE19_CONTRACT.md §1 "API" → Admin.
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

const API_SETTINGS = {
  welcome_coupon_enabled: true,
  welcome_coupon_triggers: ['signup', 'newsletter'],
  welcome_coupon_type: 'percent',
  welcome_coupon_value: '10.00',
  welcome_coupon_min_subtotal: '500.00',
  welcome_coupon_valid_days: 30,
  welcome_coupon_first_order_only: true,
}
const API_WELCOME = {
  data: {
    settings: API_SETTINGS,
    offer: { type: 'percent', value: '10.00', label: '10% off', min_subtotal: '৳500', valid_days: 30, first_order_only: true, triggers: ['signup', 'newsletter'], secret: 'x' },
    stats: { issued: 12, used: 3, expired: 2, active: 7 },
  },
}

describe('the welcome coupon', () => {
  it('reads the settings, the preview and the stats in the admin’s names', async () => {
    const calls = fakeLaravel({ 'GET /api/admin/v1/marketing/welcome-coupon': { body: API_WELCOME } })
    const response = await admin('marketing/welcome-coupon')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(toApi(calls)[0].path).toBe('/api/admin/v1/marketing/welcome-coupon')
    expect(body.settings).toEqual({ enabled: true, triggers: ['signup', 'newsletter'], type: 'percent', value: 10, minSubtotal: 500, validDays: 30, firstOrderOnly: true })
    expect(body.offer).toEqual({ type: 'percent', value: 10, label: '10% off', minSubtotal: '৳500', validDays: 30, firstOrderOnly: true, triggers: ['signup', 'newsletter'] })
    expect(body.stats).toEqual({ issued: 12, used: 3, active: 7, expired: 2 })
    expect(JSON.stringify(body)).not.toContain('secret')
  })

  it('reads settings without the prefix too, and fills in the defaults', () => {
    expect(welcomeSettings({ enabled: false, triggers: ['newsletter', 'spam'], type: 'fixed', value: '100.00', min_subtotal: null, valid_days: '14', first_order_only: false })).toEqual({
      enabled: false, triggers: ['newsletter'], type: 'fixed', value: 100, minSubtotal: null, validDays: 14, firstOrderOnly: false,
    })
    expect(welcomeSettings(undefined)).toEqual({ enabled: false, triggers: ['signup', 'newsletter'], type: 'percent', value: 0, minSubtotal: null, validDays: 30, firstOrderOnly: true })
  })

  it('saves partial settings under the API’s names, and checks them first', async () => {
    const calls = fakeLaravel({ 'PUT /api/admin/v1/marketing/welcome-coupon': (entry) => ({ body: { data: { ...API_WELCOME.data, settings: { ...API_SETTINGS, ...sent(entry) } } } }) })
    const response = await admin('marketing/welcome-coupon', { method: 'PUT', body: { enabled: false, type: 'fixed', value: 100, minSubtotal: null, validDays: 7 } })
    expect(response.status).toBe(200)
    expect(sent(toApi(calls)[0])).toEqual({ welcome_coupon_enabled: false, welcome_coupon_type: 'fixed', welcome_coupon_value: '100.00', welcome_coupon_min_subtotal: null, welcome_coupon_valid_days: 7 })
    expect((await response.json()).settings).toMatchObject({ enabled: false, type: 'fixed', value: 100, minSubtotal: null, validDays: 7 })

    await admin('marketing/welcome-coupon', { method: 'PUT', body: { triggers: ['newsletter'], type: 'percent', value: 15, minSubtotal: 250.5, firstOrderOnly: false } })
    expect(sent(toApi(calls)[1])).toEqual({ welcome_coupon_triggers: ['newsletter'], welcome_coupon_type: 'percent', welcome_coupon_value: '15.00', welcome_coupon_min_subtotal: '250.50', welcome_coupon_first_order_only: false })

    const bad = await admin('marketing/welcome-coupon', { method: 'PUT', body: { triggers: [], type: 'percent', value: 95, validDays: 400, minSubtotal: -1 } })
    expect(bad.status).toBe(422)
    const { errors } = await bad.json()
    expect(errors).toEqual({
      triggers: ['Choose at least one way to earn the code.'],
      value: ['A percentage discount is between 1 and 90.'],
      validDays: ['A code is valid for 1 to 365 days.'],
      minSubtotal: [expect.stringMatching(/minimum order/)],
    })
    expect(toApi(calls)).toHaveLength(2)
  })

  it('checks each setting', () => {
    expect(validateWelcomeCoupon({}).errors).toBeDefined()
    expect(validateWelcomeCoupon({ enabled: 'yes' }).errors.enabled).toBeDefined()
    expect(validateWelcomeCoupon({ triggers: ['signup', 'signup', 'newsletter'] }).values).toEqual({ triggers: ['signup', 'newsletter'] })
    expect(validateWelcomeCoupon({ triggers: ['email'] }).errors.triggers).toEqual(['Choose at least one way to earn the code.'])
    expect(validateWelcomeCoupon({ type: 'percent', value: 12.5 }).errors.value).toEqual(['A percentage discount is between 1 and 90.'])
    expect(validateWelcomeCoupon({ type: 'percent', value: 90 }).values).toEqual({ type: 'percent', value: 90 })
    expect(validateWelcomeCoupon({ type: 'fixed', value: 0 }).errors.value).toBeDefined()
    expect(validateWelcomeCoupon({ type: 'fixed', value: 100_001 }).errors.value).toBeDefined()
    expect(validateWelcomeCoupon({ type: 'fixed', value: 99.999 }).errors.value).toBeDefined()
    expect(validateWelcomeCoupon({ type: 'fixed', value: 100_000 }).values.value).toBe(100_000)
    expect(validateWelcomeCoupon({ type: 'free', value: 10 }).errors).toEqual({ type: ['Choose a percentage or a fixed amount.'] })
    expect(validateWelcomeCoupon({ minSubtotal: '' }).values).toEqual({ minSubtotal: null })
    expect(validateWelcomeCoupon({ validDays: 1.5 }).errors.validDays).toBeDefined()
    expect(validateWelcomeCoupon({ firstOrderOnly: 'no' }).errors.firstOrderOnly).toBeDefined()
    expect(toWelcomeBody({ value: 20 })).toEqual({ welcome_coupon_value: '20.00' })
  })

  it('maps the API’s field errors to the form’s names', async () => {
    fakeLaravel({
      'PUT /api/admin/v1/marketing/welcome-coupon': {
        status: 422,
        body: { message: 'Invalid', errors: { welcome_coupon_value: ['A percentage discount is between 1 and 90.'], 'welcome_coupon_triggers.0': ['Choose at least one way to earn the code.'] } },
      },
    })
    const response = await admin('marketing/welcome-coupon', { method: 'PUT', body: { value: 10 } })
    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual({ value: ['A percentage discount is between 1 and 90.'], triggers: ['Choose at least one way to earn the code.'] })
  })

  it('lists the codes issued, newest first, with the status filter and search', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/marketing/welcome-coupon/codes': {
        body: {
          data: [
            { id: 9, code: 'WELCOME-ABC234', email: 'nadia@example.com', trigger: 'signup', customer: { id: 5, name: 'Nadia Rahman' }, issued_at: '2026-11-26T09:00:00Z', expires_at: '2026-12-26T17:59:59Z', status: 'used', used_on_order: 'BN-100042' },
            { code: 'WELCOME-XYZ789', email: 'guest@example.com', trigger: 'newsletter', customer: null, issued_at: '2026-11-25T09:00:00Z', expires_at: '2026-12-25T17:59:59Z', status: 'active', used_on_order: null },
          ],
          links: { next: null },
          meta: { total: 41, current_page: 2, per_page: 20 },
        },
      },
    })
    const body = await (await admin('marketing/welcome-coupon/codes?status=used&q=%20nadia%20&limit=20&skip=20')).json()
    const [request] = toApi(calls)
    expect(Object.fromEntries(new URLSearchParams(request.search))).toEqual({ page: '2', per_page: '20', status: 'used', search: 'nadia' })
    expect(body.total).toBe(41)
    expect(body.codes[0]).toEqual({ id: 9, code: 'WELCOME-ABC234', email: 'nadia@example.com', trigger: 'signup', customer: { id: 5, name: 'Nadia Rahman' }, issuedAt: '2026-11-26T09:00:00Z', expiresAt: '2026-12-26T17:59:59Z', status: 'used', usedOnOrder: 'BN-100042' })
    expect(body.codes[1]).toMatchObject({ trigger: 'newsletter', customer: null, status: 'active', usedOnOrder: null })

    await admin('marketing/welcome-coupon/codes?status=everything')
    expect(new URLSearchParams(toApi(calls)[1].search).has('status')).toBe(false)
    expect(welcomeCode({ code: 'WELCOME-A', used_on_order: 100042, status: 'odd' })).toMatchObject({ id: null, usedOnOrder: '100042', status: 'active', trigger: null })
  })

  it('passes the API’s permission refusal on, and needs the BuyNest backend', async () => {
    fakeLaravel({ 'GET /api/admin/v1/marketing/welcome-coupon': { status: 403, body: { message: 'Forbidden', code: 'permission_denied', permission: 'coupons.view' } } })
    const refused = await admin('marketing/welcome-coupon')
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ code: 'permission_denied', permission: 'coupons.view' })

    expect((await admin('marketing/welcome-coupon/other')).status).toBe(404)
    expect((await admin('marketing/other')).status).toBe(404)
    expect((await admin('marketing/welcome-coupon', { method: 'DELETE' })).status).toBe(404)

    vi.stubEnv('VITE_API_PROVIDER', 'dummyjson')
    const demo = await admin('marketing/welcome-coupon')
    expect(demo.status).toBe(404)
    expect((await demo.json()).message).toMatch(/BuyNest backend/)
  })
})

describe('coupons: source, issued-to email, first order only', () => {
  const COUPON = {
    id: 9, code: 'WELCOME-ABC234', description: 'Welcome offer for nadia@example.com', type: 'percent', value: '10.00', min_subtotal: '500.00', starts_at: '2026-11-26T09:00:00Z', ends_at: '2026-12-26T17:59:59Z',
    usage_limit: 1, usage_limit_per_customer: 1, times_used: 0, is_active: true, status: 'active', applies_to: 'all', auto_apply: false,
    source: 'welcome', issued_to_email: 'nadia@example.com', first_order_only: true,
  }

  it('maps the new fields, with old answers as staff coupons', () => {
    expect(couponPhase19(COUPON)).toEqual({ source: 'welcome', issuedToEmail: 'nadia@example.com', firstOrderOnly: true })
    expect(couponPhase19({})).toEqual({ source: 'staff', issuedToEmail: null, firstOrderOnly: false })
    expect(couponPhase19({ source: 'other' }).source).toBe('staff')
  })

  it('filters the list by source (none: all, as before) and shows the fields', async () => {
    const calls = fakeLaravel({ 'GET /api/admin/v1/coupons': { body: { data: [COUPON], meta: { total: 1 } } } })
    const list = await (await admin('coupons?source=welcome')).json()
    expect(new URLSearchParams(toApi(calls)[0].search).get('source')).toBe('welcome')
    expect(list.coupons[0]).toMatchObject({ code: 'WELCOME-ABC234', source: 'welcome', issuedToEmail: 'nadia@example.com', firstOrderOnly: true })
    await admin('coupons?source=staff')
    expect(new URLSearchParams(toApi(calls)[1].search).get('source')).toBe('staff')
    await admin('coupons?source=junk')
    expect(new URLSearchParams(toApi(calls)[2].search).has('source')).toBe(false)
    await admin('coupons')
    expect(new URLSearchParams(toApi(calls)[3].search).has('source')).toBe(false)
  })

  it('sends "first order only" on a staff coupon, and switches a welcome code off', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/coupons': (entry) => ({ status: 201, body: { data: { ...COUPON, id: 10, code: 'FIRST10', source: 'staff', issued_to_email: null, first_order_only: sent(entry).first_order_only } } }),
      'PATCH /api/admin/v1/coupons/9': (entry) => ({ body: { data: { ...COUPON, is_active: sent(entry).is_active, status: 'inactive' } } }),
    })
    const created = await admin('coupons', { method: 'POST', body: { code: 'first10', type: 'percent', value: 10, firstOrderOnly: true } })
    expect(created.status).toBe(201)
    expect(sent(toApi(calls)[0])).toMatchObject({ code: 'FIRST10', first_order_only: true })
    expect((await created.json()).coupon).toMatchObject({ source: 'staff', firstOrderOnly: true })

    const off = await admin('coupons/9', { method: 'PATCH', body: { isActive: false } })
    expect(sent(toApi(calls)[1])).toEqual({ is_active: false })
    expect((await off.json()).coupon).toMatchObject({ source: 'welcome', isActive: false })

    expect(validateCoupon({ firstOrderOnly: 'yes' }, { partial: true }).errors.firstOrderOnly).toBeDefined()
    expect(validateCoupon({ firstOrderOnly: false }, { partial: true }).values).toEqual({ firstOrderOnly: false })
    // Never sent unless the form sends it.
    expect(validateCoupon({ isActive: true }, { partial: true }).values).toEqual({ isActive: true })
  })
})
