// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

/*
 * Phase 9 admin routes (adminSecurityApi.js): two-step sign-in, backups,
 * stock alerts, and the phase 9 fields on settings, admin users, products,
 * and images. Laravel is faked; shapes from "Implementation notes — part A
 * and part B" in docs/backend/PHASE9_CONTRACT.md.
 */

const SITE = 'https://shop.example'
const ADMIN = { id: 1, name: 'Store Owner', email: 'owner@buynest.test', role: { id: 1, name: 'Owner' }, permissions: ['backups.view', 'reports.view'], two_factor_enabled: true, two_factor: { enabled: true, confirmed_at: '2026-11-17T10:00:00Z', recovery_codes_left: 9, required: false } }
const TOKENS = { access_token: '5|FULL', access_expires_in: 3600, refresh_token: 'RT-FULL', refresh_expires_in: 86400, remember: false, scope: 'full' }
const CHALLENGE = 'a'.repeat(64)
const SIGNATURE = 'f'.repeat(64)

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const entry = { method: init.method ?? 'GET', path: pathname, search, headers: init.headers ?? {}, body: init.body }
    calls.push(entry)
    const key = `${entry.method} ${pathname}`
    const found = routes[key] ?? (key === 'GET /api/admin/v1/me' ? { body: { data: ADMIN } } : undefined)
    const route = typeof found === 'function' ? found(entry) : (found ?? { status: 404, body: { message: 'Not found' } })
    if (route.raw) return route.raw
    return new Response(route.status === 204 ? null : JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

function admin(action, { method = 'GET', body, cookie = 'buynest_admin_at=9|ADMIN' } = {}) {
  return handleApiRequest(
    new Request(`${SITE}/api/admin/${action}`, {
      method,
      headers: { 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  )
}
const sent = (entry) => JSON.parse(entry.body)
const toApi = (calls) => calls.filter((entry) => entry.path !== '/api/admin/v1/me')
const cookieNames = (response) => response.headers.getSetCookie().map((cookie) => cookie.split('=')[0])

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('two-step sign-in', () => {
  it('a correct password with two-step on answers with the challenge only: no cookies, no tokens', async () => {
    fakeLaravel({ 'POST /api/admin/v1/auth/login': { body: { data: { two_factor_required: true, challenge: CHALLENGE, expires_at: '2026-11-17T10:05:00Z' } } } })
    const response = await admin('auth/login', { method: 'POST', body: { email: 'owner@buynest.test', password: 'x', remember: true }, cookie: null })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ twoFactorRequired: true, challenge: CHALLENGE, expiresAt: '2026-11-17T10:05:00Z' })
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('without two-step the sign-in is as before (profile + HttpOnly cookies), now with the two-step fields', async () => {
    fakeLaravel({ 'POST /api/admin/v1/auth/login': { body: { data: { admin: { ...ADMIN, two_factor_enabled: false, two_factor: { ...ADMIN.two_factor, enabled: false } }, tokens: TOKENS } } } })
    const response = await admin('auth/login', { method: 'POST', body: { email: 'owner@buynest.test', password: 'x' }, cookie: null })
    const body = await response.json()
    expect(body).toMatchObject({ id: 1, email: 'owner@buynest.test', twoFactorEnabled: false, twoFactorRequiredByStore: false, twoFactorSetupRequired: false })
    expect(JSON.stringify(body)).not.toContain('FULL')
    expect(cookieNames(response)).toEqual(expect.arrayContaining(['buynest_admin_at', 'buynest_admin_rt']))
    expect(response.headers.getSetCookie().find((cookie) => cookie.startsWith('buynest_admin_at='))).toContain('HttpOnly')
  })

  it('the store requires two-step and the admin has none: a limited session, flagged for the setup screen', async () => {
    fakeLaravel({ 'POST /api/admin/v1/auth/login': { body: { data: { two_factor_setup_required: true, admin: { ...ADMIN, two_factor_enabled: false, two_factor: { enabled: false, required: true, recovery_codes_left: 0 } }, tokens: { ...TOKENS, access_token: '6|LIMITED', scope: 'two_factor_setup' } } } } })
    const response = await admin('auth/login', { method: 'POST', body: { email: 'owner@buynest.test', password: 'x' }, cookie: null })
    expect(await response.json()).toMatchObject({ twoFactorSetupRequired: true, twoFactorRequiredByStore: true, twoFactorEnabled: false })
    expect(response.headers.getSetCookie().find((cookie) => cookie.startsWith('buynest_admin_at='))).toContain('6%7CLIMITED')
  })

  it('the second step checks the shape here, then sets the session cookies', async () => {
    const calls = fakeLaravel({ 'POST /api/admin/v1/auth/two-factor': { body: { data: { admin: ADMIN, tokens: { ...TOKENS, remember: true } } } } })
    expect((await admin('auth/two-factor', { method: 'POST', body: { challenge: 'short', code: '123456' }, cookie: null })).status).toBe(422)
    const badCode = await admin('auth/two-factor', { method: 'POST', body: { challenge: CHALLENGE, code: '12345' }, cookie: null })
    expect((await badCode.json()).errors).toEqual({ code: ['Enter the 6-digit code from your authenticator app.'] })
    expect(calls).toHaveLength(0)

    const response = await admin('auth/two-factor', { method: 'POST', body: { challenge: CHALLENGE, code: '123 456', remember: true }, cookie: null })
    expect(response.status).toBe(200)
    expect(sent(calls[0])).toEqual({ challenge: CHALLENGE, code: '123456', remember: true })
    expect(await response.json()).toMatchObject({ id: 1, twoFactorEnabled: true, recoveryCodesLeft: 9 })
    // "Keep me signed in": the cookies last 7 days.
    expect(response.headers.getSetCookie().find((cookie) => cookie.startsWith('buynest_admin_at='))).toContain('Max-Age=604800')

    await admin('auth/two-factor', { method: 'POST', body: { challenge: CHALLENGE, recoveryCode: ' ABCDE12345 ' }, cookie: null })
    expect(sent(calls[1])).toEqual({ challenge: CHALLENGE, recovery_code: 'abcde12345', remember: false })
  })

  it('passes the API’s refusals on with app field names and no cookies', async () => {
    fakeLaravel({
      'POST /api/admin/v1/auth/two-factor': (entry) =>
        sent(entry).recovery_code
          ? { status: 422, body: { message: 'x', errors: { recovery_code: ["That recovery code isn't right or was already used."] } } }
          : { status: 422, body: { message: 'Too many wrong codes. Please sign in again.', errors: { challenge: ['Too many wrong codes. Please sign in again.'] } } },
    })
    const burned = await admin('auth/two-factor', { method: 'POST', body: { challenge: CHALLENGE, code: '000000' }, cookie: null })
    expect(burned.status).toBe(422)
    expect((await burned.json()).errors).toEqual({ challenge: ['Too many wrong codes. Please sign in again.'] })
    expect(burned.headers.getSetCookie()).toEqual([])
    const wrong = await admin('auth/two-factor', { method: 'POST', body: { challenge: CHALLENGE, recoveryCode: 'abcde-12345' }, cookie: null })
    expect((await wrong.json()).errors).toEqual({ recoveryCode: ["That recovery code isn't right or was already used."] })
  })

  it('GET me carries the two-step state', async () => {
    fakeLaravel({ 'GET /api/admin/v1/me': { body: { data: { ...ADMIN, two_factor_enabled: false, two_factor: { enabled: false, required: true, recovery_codes_left: 0 } } } } })
    expect(await (await admin('me')).json()).toMatchObject({ twoFactorEnabled: false, twoFactorRequiredByStore: true, twoFactorSetupRequired: true })
  })
})

describe('two-step enrolment and the Owner reset', () => {
  it('start → { secret, otpauthUrl, qrSvg }', async () => {
    fakeLaravel({ 'POST /api/admin/v1/me/two-factor': { body: { data: { secret: 'JBSWY3DP', otpauth_url: 'otpauth://totp/BuyNest:o', qr_svg: '<svg/>' } } } })
    expect(await (await admin('me/two-factor', { method: 'POST', body: {} })).json()).toEqual({ secret: 'JBSWY3DP', otpauthUrl: 'otpauth://totp/BuyNest:o', qrSvg: '<svg/>' })
  })

  it('confirm with the limited session swaps in the full pair (same "remember"); without tokens no cookies change', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/me/two-factor/confirm': (entry) => ({
        body: { data: { recovery_codes: ['abcde-12345', 'fghij-67890'], admin: ADMIN, ...(entry.headers.Authorization === 'Bearer 6|LIMITED' && { tokens: TOKENS }) } },
      }),
    })
    expect((await admin('me/two-factor/confirm', { method: 'POST', body: { code: 'abc' } })).status).toBe(422)
    const limited = await admin('me/two-factor/confirm', { method: 'POST', body: { code: '123456' }, cookie: 'buynest_admin_at=6|LIMITED; buynest_admin_remember=1' })
    expect(await limited.json()).toMatchObject({ recoveryCodes: ['abcde-12345', 'fghij-67890'], admin: { twoFactorEnabled: true } })
    const access = limited.headers.getSetCookie().find((cookie) => cookie.startsWith('buynest_admin_at='))
    expect(access).toContain('5%7CFULL')
    expect(access).toContain('Max-Age=604800')
    expect(sent(toApi(calls)[0])).toEqual({ code: '123456' })

    const full = await admin('me/two-factor/confirm', { method: 'POST', body: { code: '123456' } })
    expect(full.headers.getSetCookie()).toEqual([])
    expect(JSON.stringify(await full.json())).not.toContain('FULL')
  })

  it('new recovery codes need the password; turning off sends the password and a code', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/me/two-factor/recovery-codes': { body: { data: { recovery_codes: ['x1234-56789'] } } },
      'DELETE /api/admin/v1/me/two-factor': { body: { message: 'Two-step sign-in is off.', data: { ...ADMIN, two_factor_enabled: false, two_factor: { ...ADMIN.two_factor, enabled: false } } } },
    })
    expect((await admin('me/two-factor/recovery-codes', { method: 'POST', body: {} })).status).toBe(422)
    expect(await (await admin('me/two-factor/recovery-codes', { method: 'POST', body: { password: 'pw' } })).json()).toEqual({ recoveryCodes: ['x1234-56789'] })
    expect((await admin('me/two-factor', { method: 'DELETE', body: { password: 'pw', code: 'nope' } })).status).toBe(422)
    const off = await admin('me/two-factor', { method: 'DELETE', body: { password: 'pw', code: '654321' } })
    expect(await off.json()).toMatchObject({ ok: true, message: 'Two-step sign-in is off.', admin: { twoFactorEnabled: false } })
    expect(sent(toApi(calls).at(-1))).toEqual({ password: 'pw', code: '654321' })
  })

  it('the Owner reset passes 403 owner_only on, and maps the answer', async () => {
    fakeLaravel({
      'POST /api/admin/v1/admins/2/two-factor/reset': { body: { message: 'Two-step sign-in was reset. Sam has been signed out everywhere.', data: { id: 2, name: 'Sam', email: 's@x', is_active: true, two_factor_enabled: false } } },
      'POST /api/admin/v1/admins/3/two-factor/reset': { status: 403, body: { message: 'Only an Owner can do this.', code: 'owner_only' } },
    })
    expect(await (await admin('admins/2/two-factor/reset', { method: 'POST', body: {} })).json()).toMatchObject({ ok: true, admin: { id: 2, twoFactorEnabled: false } })
    const refused = await admin('admins/3/two-factor/reset', { method: 'POST', body: {} })
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ message: 'Only an Owner can do this.', code: 'owner_only' })
    expect((await admin('admins/x/two-factor/reset', { method: 'POST', body: {} })).status).toBe(404)
  })

  it('settings carry security.requireAdminTwoFactor; admin rows say whether two-step is on', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/settings': { body: { data: { security: { require_admin_two_factor: true } } } },
      'PATCH /api/admin/v1/settings': { status: 422, body: { message: 'x', errors: { 'security.require_admin_two_factor': ['Turn on two-step sign-in for your own account first.'] } } },
      'GET /api/admin/v1/admins': { body: { data: [{ id: 2, name: 'Sam', email: 's@x', is_active: true, two_factor_enabled: true }], meta: { total: 1 } } },
    })
    expect((await (await admin('settings')).json()).security).toEqual({ requireAdminTwoFactor: true })
    expect((await admin('settings', { method: 'PATCH', body: { security: { requireAdminTwoFactor: 'yes' } } })).status).toBe(422)
    const refused = await admin('settings', { method: 'PATCH', body: { security: { requireAdminTwoFactor: true } } })
    expect((await refused.json()).errors).toEqual({ 'security.requireAdminTwoFactor': ['Turn on two-step sign-in for your own account first.'] })
    expect(sent(toApi(calls).at(-1))).toEqual({ security: { require_admin_two_factor: true } })
    expect((await (await admin('admins')).json()).admins[0].twoFactorEnabled).toBe(true)
  })
})

describe('backups', () => {
  const NAME = 'buynest-20261117-030000.sql.gz'

  it('lists backups with the schedule; Back up now answers 201 with the run', async () => {
    fakeLaravel({
      'GET /api/admin/v1/backups': {
        body: { data: [{ name: NAME, size_bytes: 3400000, created_at: '2026-11-17T03:00:01Z' }, { name: '../etc/passwd', size_bytes: 1 }], meta: { disk: 'local', keep_days: 14, schedule: '03:00', timezone: 'UTC', running: false, last_run: null } },
      },
      'POST /api/admin/v1/backups': { status: 201, body: { data: { id: 3, status: 'ok', trigger: 'admin', file_name: 'buynest-20261117-101500.sql.gz', size_bytes: 10, error: null, started_at: 'S', finished_at: 'F', admin: { id: 1, name: 'Store Owner' } } } },
    })
    expect(await (await admin('backups')).json()).toEqual({
      backups: [{ name: NAME, size: 3400000, createdAt: '2026-11-17T03:00:01Z' }],
      keepDays: 14,
      schedule: '03:00',
      timezone: 'UTC',
      disk: 'local',
      running: false,
      lastRun: null,
      live: true,
    })
    const made = await admin('backups', { method: 'POST', body: {} })
    expect(made.status).toBe(201)
    expect(await made.json()).toMatchObject({ backup: { status: 'ok', name: 'buynest-20261117-101500.sql.gz', adminName: 'Store Owner' }, message: 'Backup buynest-20261117-101500.sql.gz is ready.' })
  })

  it('a download link points at this service, keeping the signed query unchanged', async () => {
    fakeLaravel({ [`POST /api/admin/v1/backups/${NAME}/link`]: { body: { data: { url: `/api/admin/v1/backups/${NAME}/download?expires=1763380000&signature=${SIGNATURE}`, expires_at: 'E' } } } })
    expect(await (await admin(`backups/${NAME}/download`, { method: 'POST', body: {} })).json()).toEqual({
      url: `/api/admin/backups/${NAME}/file?expires=1763380000&signature=${SIGNATURE}`,
      expiresAt: 'E',
    })
  })

  it('refuses a link that is not this backup’s download', async () => {
    fakeLaravel({ [`POST /api/admin/v1/backups/${NAME}/link`]: { body: { data: { url: `https://evil.test/x?expires=1&signature=${SIGNATURE}` } } } })
    expect((await admin(`backups/${NAME}/download`, { method: 'POST', body: {} })).status).toBe(502)
  })

  it('streams the file with the admin token and the same signature; anything else is refused before the API', async () => {
    const calls = fakeLaravel({
      [`GET /api/admin/v1/backups/${NAME}/download`]: {
        raw: new Response(new Uint8Array([0x1f, 0x8b, 8, 0]), { status: 200, headers: { 'Content-Type': 'application/gzip', 'Content-Length': '4' } }),
      },
    })
    const response = await admin(`backups/${NAME}/file?expires=1763380000&signature=${SIGNATURE}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${NAME}"`)
    expect(response.headers.get('content-type')).toBe('application/gzip')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0x1f, 0x8b, 8, 0]))
    const download = toApi(calls)[0]
    expect(download.search).toBe(`?expires=1763380000&signature=${SIGNATURE}`)
    expect(download.headers.Authorization).toBe('Bearer 9|ADMIN')

    expect((await admin(`backups/${NAME}/file?expires=1&signature=nothex&x=1`)).status).toBe(403)
    expect((await admin('backups/..%2F.env/file?expires=1')).status).toBe(404)
    expect((await admin(`backups/${NAME}/file?expires=1&signature=${SIGNATURE}`, { cookie: null })).status).toBe(401)
    expect(toApi(calls)).toHaveLength(1)
  })

  it('passes an expired link’s 403 on', async () => {
    fakeLaravel({ [`GET /api/admin/v1/backups/${NAME}/download`]: { status: 403, body: { message: 'This download link has expired. Create a new one.' } } })
    const response = await admin(`backups/${NAME}/file?signature=${SIGNATURE}&expires=1`)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ message: 'This download link has expired. Create a new one.' })
  })
})

describe('stock alerts, waiting counts, resized photos', () => {
  it('the report maps products, variants, and totals', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/reports/stock-alerts': {
        body: {
          data: [{ product: { id: 4, name: 'T-shirt', sku: 'TS', status: 'active', stock_quantity: 0, thumbnail_url: 't.webp', has_variants: true }, waiting: 3, variants: [{ id: 21, sku: 'TS-s', label: 'Size: S', stock_quantity: 0, waiting: 2 }], oldest_at: 'O', newest_at: 'N' }],
          meta: { total: 1, waiting_total: 3, notified_last_30_days: 5, limit: 10, skip: 0 },
        },
      },
    })
    expect(await (await admin('reports/stock-alerts?limit=10&skip=0&q=%20shirt%20')).json()).toEqual({
      products: [{ productId: 4, name: 'T-shirt', sku: 'TS', status: 'active', stock: 0, thumbnail: 't.webp', hasVariants: true, waiting: 3, variants: [{ id: 21, sku: 'TS-s', label: 'Size: S', stock: 0, waiting: 2 }], oldestAt: 'O', newestAt: 'N' }],
      total: 1,
      waitingTotal: 3,
      notifiedLast30Days: 5,
      limit: 10,
      skip: 0,
      live: true,
    })
    expect(toApi(calls)[0].search).toBe('?limit=10&skip=0&q=shirt')
  })

  it('product detail has stockAlertsWaiting; images carry their resized copies', async () => {
    fakeLaravel({
      'GET /api/admin/v1/products/4': {
        body: {
          data: {
            id: 4, name: 'T-shirt', price: '20.00', stock_quantity: 0, stock_alerts_waiting: 3,
            images: [{ id: 7, url: '/media/products/4/a.jpg', alt: '', position: 0, is_upload: true, variants: { 320: '/media/products/4/a-320.webp', 960: '/media/products/4/a-960.webp', 9999: 'javascript:alert(1)' } }],
          },
        },
      },
    })
    const product = await (await admin('products/4')).json()
    expect(product.stockAlertsWaiting).toBe(3)
    expect(product.imageList[0].variants).toEqual({ 320: '/media/products/4/a-320.webp', 960: '/media/products/4/a-960.webp' })
  })
})
