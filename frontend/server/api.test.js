// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

const SITE = 'https://shop.example'

/** Fakes DummyJSON: `routes` maps "METHOD /path" to { status, body }. Records each call. */
function fakeUpstream(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname } = new URL(url)
    calls.push({ path: pathname, init })
    const route = routes[`${init.method ?? 'GET'} ${pathname}`] ?? { status: 404, body: { message: 'Not found' } }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

const call = (action, { method = 'GET', body, cookie, site = 'same-origin', service = 'auth', ip } = {}) =>
  handleApiRequest(
    new Request(`${SITE}/api/${service}/${action}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': site, ...(cookie && { Cookie: cookie }), ...(ip && { 'X-Real-IP': ip }) },
      body: body && JSON.stringify(body),
    }),
  )

const LOGIN_OK = {
  'POST /auth/login': { body: { id: 1, firstName: 'Emily', accessToken: 'AT', refreshToken: 'RT' } },
  'GET /auth/me': { body: { id: 1, firstName: 'Emily', role: 'admin' } },
}

describe('sign-in service (server/authBff.js)', () => {
  it('signs in without ever returning a token, and sets locked-down cookies', async () => {
    fakeUpstream(LOGIN_OK)
    const response = await call('login', { method: 'POST', body: { username: 'emilys', password: 'x', remember: false } })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toMatch(/AT|RT|token/)

    const cookies = response.headers.getSetCookie()
    const access = cookies.find((cookie) => cookie.startsWith('buynest_at='))
    expect(access).toMatch(/HttpOnly/)
    expect(access).toMatch(/Secure/)
    expect(access).toMatch(/SameSite=Strict/)
    expect(access).toMatch(/Path=\/api;/) // sign-in and admin services only
    expect(access).not.toMatch(/Max-Age/) // not remembered: ends when the browser closes
    const hint = cookies.find((cookie) => cookie.startsWith('buynest_session='))
    expect(hint).not.toMatch(/HttpOnly/) // the readable hint
    expect(hint).toMatch(/^buynest_session=session;/)
  })

  it('returns the role with the sign-in (the login reply alone lacks it)', async () => {
    const calls = fakeUpstream(LOGIN_OK)
    const response = await call('login', { method: 'POST', body: { username: 'emilys', password: 'x' } })
    expect(await response.json()).toMatchObject({ id: 1, role: 'admin' })
    expect(calls[1].init.headers.Authorization).toBe('Bearer AT')
  })

  it('"Remember me" makes the cookies last 7 days', async () => {
    const calls = fakeUpstream(LOGIN_OK)
    const response = await call('login', { method: 'POST', body: { username: 'emilys', password: 'x', remember: true } })
    const current = response.headers.getSetCookie().filter((cookie) => !cookie.includes('Path=/api/auth'))
    expect(current.every((cookie) => cookie.includes('Max-Age=604800'))).toBe(true)
    expect(response.headers.getSetCookie()).toContainEqual(expect.stringMatching(/^buynest_session=remember;/))
    expect(JSON.parse(calls[0].init.body).expiresInMins).toBe(7 * 24 * 60)
  })

  it('passes wrong credentials through as an error, with no cookies', async () => {
    fakeUpstream({ 'POST /auth/login': { status: 400, body: { message: 'Invalid credentials' } } })
    const response = await call('login', { method: 'POST', body: { username: 'emilys', password: 'nope' } })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ message: 'Invalid credentials' })
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('sends the access token cookie to DummyJSON as a Bearer header', async () => {
    const calls = fakeUpstream({ 'GET /auth/me': { body: { id: 1, firstName: 'Emily' } } })
    const response = await call('me', { cookie: 'buynest_at=AT' })
    expect(await response.json()).toEqual({ id: 1, firstName: 'Emily' })
    expect(calls[0].init.headers.Authorization).toBe('Bearer AT')
  })

  // DummyJSON user records include these; the browser must never receive them.
  it('never forwards passwords, card, bank, or SSN data', async () => {
    const raw = {
      id: 1,
      firstName: 'Emily',
      password: 'emilyspass',
      ssn: '900-590-289',
      bank: { cardNumber: '9289760655481815', iban: 'YPUXISOBI7TTHPK2BR3HAIXL' },
      ip: '42.48.100.32',
      address: { address: '626 Main Street', city: 'Phoenix', coordinates: { lat: 1, lng: 2 } },
    }
    fakeUpstream({ 'GET /auth/me': { body: raw }, 'POST /auth/login': { body: { ...raw, accessToken: 'AT', refreshToken: 'RT' } } })
    for (const response of [await call('me', { cookie: 'buynest_at=AT' }), await call('login', { method: 'POST', body: { username: 'a', password: 'b' } })]) {
      const text = await response.text()
      expect(text).not.toMatch(/emilyspass|900-590|9289760655481815|YPUXISOBI|42\.48|coordinates/)
      expect(JSON.parse(text).address).toEqual({ address: '626 Main Street', city: 'Phoenix' })
    }
  })

  it('answers 401 without a session, without calling DummyJSON', async () => {
    const calls = fakeUpstream({})
    expect((await call('me')).status).toBe(401)
    expect(calls).toEqual([])
  })

  it('renews the session from the refresh cookie, keeping the "remember" choice', async () => {
    const calls = fakeUpstream({ 'POST /auth/refresh': { body: { accessToken: 'AT2', refreshToken: 'RT2' } } })
    const response = await call('refresh', { method: 'POST', cookie: 'buynest_rt=RT; buynest_remember=1' })
    expect(await response.json()).toEqual({ ok: true })
    expect(JSON.parse(calls[0].init.body)).toEqual({ refreshToken: 'RT', expiresInMins: 7 * 24 * 60 })
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith('buynest_at=AT2'))).toBe(true)
  })

  it('a rejected refresh clears the cookies; a server outage keeps them', async () => {
    fakeUpstream({ 'POST /auth/refresh': { status: 403, body: { message: 'Invalid refresh token' } } })
    const rejected = await call('refresh', { method: 'POST', cookie: 'buynest_rt=RT' })
    expect(rejected.headers.getSetCookie().length).toBeGreaterThan(0)
    expect(rejected.headers.getSetCookie().every((cookie) => cookie.includes('Max-Age=0'))).toBe(true)

    fakeUpstream({ 'POST /auth/refresh': { status: 503, body: { message: 'Down' } } })
    const outage = await call('refresh', { method: 'POST', cookie: 'buynest_rt=RT' })
    expect(outage.headers.getSetCookie()).toEqual([])
  })

  it('edits only the signed-in account, and only allowed fields', async () => {
    const calls = fakeUpstream({ 'GET /auth/me': { body: { id: 7 } }, 'PUT /users/7': { body: { id: 7, firstName: 'Em' } } })
    await call('profile', { method: 'PUT', cookie: 'buynest_at=AT', body: { firstName: 'Em', id: 99, role: 'admin' } })
    expect(calls[1].path).toBe('/users/7')
    expect(JSON.parse(calls[1].init.body)).toEqual({ firstName: 'Em' })
  })

  it('signs out by expiring every cookie', async () => {
    const response = await call('logout', { method: 'POST' })
    const cookies = response.headers.getSetCookie()
    expect(cookies).toHaveLength(7) // 3 session cookies + the hint + 3 copies at the pre-admin path
    expect(cookies.every((cookie) => cookie.includes('Max-Age=0'))).toBe(true)
  })

  it('refuses requests that start on another website', async () => {
    fakeUpstream(LOGIN_OK)
    const response = await call('login', { method: 'POST', body: { username: 'emilys', password: 'x' }, site: 'cross-site' })
    expect(response.status).toBe(403)
  })

  it('answers 404 for unknown actions or methods', async () => {
    expect((await call('admin')).status).toBe(404)
    expect((await call('login')).status).toBe(404) // GET instead of POST
  })
})

describe('admin service (server/adminApi.js)', () => {
  const ADMIN = { 'GET /auth/me': { body: { id: 1, role: 'admin', firstName: 'Emily' } } }
  // Admins have their own session cookies, separate from the storefront's.
  const admin = (action, options = {}) => call(action, { service: 'admin', cookie: 'buynest_admin_at=AT', ...options })

  it('refuses visitors without an admin session (401) and non-admin accounts (403) on every route', async () => {
    fakeUpstream({ 'GET /auth/me': { body: { id: 16, role: 'user' } } })
    const routes = [['overview'], ['products'], ['products/1'], ['products', 'POST'], ['products/1', 'PUT'], ['products/1', 'DELETE'], ['orders'], ['orders/1'], ['customers'], ['customers/1', 'PATCH'], ['categories'], ['me']]
    for (const [action, method = 'GET'] of routes) {
      const body = method === 'GET' || method === 'DELETE' ? undefined : {}
      expect((await call(action, { service: 'admin', method, body })).status).toBe(401)
      // A storefront (customer) session is not an admin session.
      expect((await call(action, { service: 'admin', method, body, cookie: 'buynest_at=AT' })).status).toBe(401)
      expect((await admin(action, { method, body })).status).toBe(403)
    }
  })

  it('signs admins in with their own HttpOnly cookies, never the storefront ones', async () => {
    fakeUpstream(LOGIN_OK)
    const response = await call('auth/login', { service: 'admin', method: 'POST', body: { username: 'emilys', password: 'x' } })
    expect(await response.json()).toMatchObject({ id: 1, role: 'admin', name: 'Emily' })
    const cookies = response.headers.getSetCookie()
    expect(cookies.find((cookie) => cookie.startsWith('buynest_admin_at='))).toMatch(/HttpOnly; Secure; SameSite=Strict/)
    expect(cookies.find((cookie) => cookie.startsWith('buynest_admin_at='))).toMatch(/Path=\/api\/admin;/)
    expect(cookies).toContainEqual(expect.stringMatching(/^buynest_admin_session=session; Path=\/;/))
    expect(cookies.some((cookie) => /^buynest_(at|rt|session)=/.test(cookie))).toBe(false)
  })

  it('refuses a customer account at the admin sign-in, with no cookies', async () => {
    fakeUpstream({ ...LOGIN_OK, 'GET /auth/me': { body: { id: 16, role: 'user' } } })
    const response = await call('auth/login', { service: 'admin', method: 'POST', body: { username: 'averyp', password: 'x' } })
    expect(response.status).toBe(403)
    expect((await response.json()).message).toMatch(/not a shop admin/)
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('signs admins out by expiring only the admin cookies', async () => {
    const cookies = (await call('auth/logout', { service: 'admin', method: 'POST' })).headers.getSetCookie()
    expect(cookies).toHaveLength(4)
    expect(cookies.every((cookie) => cookie.startsWith('buynest_admin_') && cookie.includes('Max-Age=0'))).toBe(true)
  })

  it('lets admins in', async () => {
    fakeUpstream(ADMIN)
    expect(await (await admin('me')).json()).toMatchObject({ id: 1, role: 'admin' })
  })

  it('lists customers without passwords, bank, or SSN data', async () => {
    fakeUpstream({
      ...ADMIN,
      'GET /users': { body: { users: [{ id: 2, firstName: 'Mike', email: 'm@x.co', password: 'secret', ssn: '1-2-3', bank: { iban: 'X' }, address: { city: 'Austin', country: 'US', address: '1 Main' } }], total: 1 } },
    })
    const body = await (await admin('customers')).json()
    expect(body.customers).toEqual([{ id: 2, firstName: 'Mike', email: 'm@x.co', city: 'Austin', country: 'US' }])
    expect(body.manageable).toBe(false) // demo users can't be blocked
  })

  it('validates product changes on the server (422, Laravel-style errors)', async () => {
    const calls = fakeUpstream(ADMIN)
    const response = await admin('products', { method: 'POST', body: { title: 'X', price: -5, stock: 1.5, discountPercentage: 95 } })
    expect(response.status).toBe(422)
    const { errors } = await response.json()
    expect(Object.keys(errors).sort()).toEqual(['category', 'discountPercentage', 'price', 'stock', 'title'])
    expect(calls.map((entry) => entry.path)).toEqual(['/auth/me']) // nothing was sent to DummyJSON
  })

  it('accepts ordinary prices like 19.99 and rejects a third decimal', async () => {
    fakeUpstream({ ...ADMIN, 'PUT /products/5': { body: { id: 5 } } })
    for (const price of [19.99, 0.1, 1234.56, 0]) expect((await admin('products/5', { method: 'PUT', body: { price } })).status).toBe(200)
    expect((await admin('products/5', { method: 'PUT', body: { price: 19.999 } })).status).toBe(422)
  })

  it('updates only allowed fields and says the change is simulated', async () => {
    const calls = fakeUpstream({ ...ADMIN, 'PUT /products/5': { body: { id: 5, title: 'Lamp', price: 12.5 } } })
    const response = await admin('products/5', { method: 'PUT', body: { price: 12.5, rating: 5, id: 99 } })
    expect(await response.json()).toEqual({ product: { id: 5, title: 'Lamp', price: 12.5 }, simulated: true })
    expect(JSON.parse(calls[1].init.body)).toEqual({ price: 12.5 })
  })

  it('answers 404 for unknown routes and non-numeric ids', async () => {
    fakeUpstream(ADMIN)
    expect((await admin('settings')).status).toBe(404)
    expect((await admin('products/abc')).status).toBe(404)
    expect((await admin('products/1/extra')).status).toBe(404)
    expect((await admin('auth/unknown', { method: 'POST' })).status).toBe(404)
  })
})

describe('with BuyNest accounts (VITE_ACCOUNTS_BACKEND=laravel)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
    vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
    vi.stubEnv('BUYNEST_BFF_KEY', 'shared-key')
  })
  afterEach(() => vi.unstubAllEnvs())

  const CUSTOMER = { id: 5, first_name: 'Nadia', last_name: 'Rahman', email: 'nadia@example.com', phone: '+8801712345678', email_verified: true }
  const TOKENS = { access_token: '1|ACCESS', refresh_token: '2|REFRESH', remember: false }
  const sentBody = (entry) => JSON.parse(entry.init.body)

  it('signs in with an email, returns the profile in camelCase, and keeps the tokens in cookies', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/auth/login': { body: { data: { customer: CUSTOMER, tokens: TOKENS } } } })
    const response = await call('login', { method: 'POST', body: { email: 'nadia@example.com', password: 'Secret123', remember: true }, ip: '203.0.113.9' })

    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ id: 5, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com', phone: '+8801712345678', emailVerified: true, role: 'customer' })
    expect(text).not.toMatch(/ACCESS|REFRESH/)
    expect(response.headers.getSetCookie()).toContainEqual(expect.stringMatching(/^buynest_at=1%7CACCESS; Path=\/api; HttpOnly/))
    expect(sentBody(calls[0])).toEqual({ email: 'nadia@example.com', password: 'Secret123', remember: true })
    // The visitor's IP goes to Laravel only with the shared key, so its rate limits count per visitor.
    expect(calls[0].init.headers).toMatchObject({ 'X-BuyNest-Bff': 'shared-key', 'X-Client-IP': '203.0.113.9' })
  })

  it('does not invent a client IP when the host gave none', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/auth/login': { body: { data: { customer: CUSTOMER, tokens: TOKENS } } } })
    await call('login', { method: 'POST', body: { email: 'a@b.co', password: 'x' } })
    expect(calls[0].init.headers['X-Client-IP']).toBeUndefined()
  })

  it('sign-up sends snake_case to Laravel and returns where the code went', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/auth/register': { status: 201, body: { message: 'Sent', data: { email: 'nadia@example.com', expires_in: 600, resend_in: 60 } } } })
    const response = await call('register', {
      method: 'POST',
      body: { firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com', phone: '+8801712345678', password: 'Secret123', confirmPassword: 'Secret123', acceptTerms: true, role: 'admin' },
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ email: 'nadia@example.com', expiresIn: 600, resendIn: 60, message: 'Sent' })
    expect(sentBody(calls[0])).toEqual({
      first_name: 'Nadia', last_name: 'Rahman', email: 'nadia@example.com', phone: '+8801712345678', password: 'Secret123', password_confirmation: 'Secret123', accept_terms: true,
    })
    expect(response.headers.getSetCookie()).toEqual([]) // not signed in until the email is confirmed
  })

  it('translates validation errors to the form field names', async () => {
    fakeUpstream({ 'POST /api/v1/auth/register': { status: 422, body: { message: 'Invalid', errors: { first_name: ['Required'], password_confirmation: ['No match'], email: ['Taken'] } } } })
    const response = await call('register', { method: 'POST', body: {} })
    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual({ firstName: ['Required'], confirmPassword: ['No match'], email: ['Taken'] })
  })

  it('the emailed code signs the customer in', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/auth/verify-email': { body: { data: { customer: CUSTOMER, tokens: TOKENS } } } })
    const response = await call('verify-email', { method: 'POST', body: { email: 'nadia@example.com', code: '123456', remember: false } })
    expect(response.status).toBe(200)
    expect(response.headers.getSetCookie()).toContainEqual(expect.stringMatching(/^buynest_session=session;/))
    expect(sentBody(calls[0])).toEqual({ email: 'nadia@example.com', code: '123456', remember: false })
  })

  it('an unconfirmed account gets 403 with the reason and where the new code went, and no cookies', async () => {
    fakeUpstream({ 'POST /api/v1/auth/login': { status: 403, body: { message: 'Confirm first', code: 'email_unverified', data: { email: 'nadia@example.com', expires_in: 600, resend_in: 60 } } } })
    const response = await call('login', { method: 'POST', body: { email: 'nadia@example.com', password: 'Secret123' } })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ message: 'Confirm first', code: 'email_unverified', data: { email: 'nadia@example.com', expiresIn: 600, resendIn: 60 } })
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('password reset and resend pass through, with only known fields', async () => {
    const calls = fakeUpstream({
      'POST /api/v1/auth/forgot-password': { body: { message: 'If an account exists…', data: { email: 'n@x.co', expires_in: 600, resend_in: 60 } } },
      'POST /api/v1/auth/reset-password': { body: { message: 'Changed' } },
      'POST /api/v1/auth/resend-code': { body: { message: 'Sent', data: { email: 'n@x.co', expires_in: 600, resend_in: 60 } } },
    })
    expect((await (await call('forgot-password', { method: 'POST', body: { email: 'n@x.co' } })).json()).resendIn).toBe(60)
    await call('reset-password', { method: 'POST', body: { email: 'n@x.co', code: '123456', password: 'New12345', confirmPassword: 'New12345' } })
    expect(sentBody(calls[1])).toEqual({ email: 'n@x.co', code: '123456', password: 'New12345', password_confirmation: 'New12345' })
    await call('resend-code', { method: 'POST', body: { email: 'n@x.co', purpose: 'anything-else' } })
    expect(sentBody(calls[2]).purpose).toBe('verify_email')
  })

  it('profile edits send only name and phone (never email) for the session account', async () => {
    const calls = fakeUpstream({ 'PATCH /api/v1/me': { body: { data: { ...CUSTOMER, phone: '+15550100100' } } } })
    const response = await call('profile', { method: 'PUT', cookie: 'buynest_at=1|ACCESS', body: { firstName: 'Nadia', phone: '+15550100100', email: 'x@evil.co', id: 1 } })
    expect((await response.json()).phone).toBe('+15550100100')
    expect(sentBody(calls[0])).toEqual({ first_name: 'Nadia', phone: '+15550100100' })
    expect(calls[0].init.headers.Authorization).toBe('Bearer 1|ACCESS')
  })

  it('sign-out revokes the tokens in Laravel, then expires the cookies', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/auth/logout': { body: { message: 'Signed out.' } } })
    const response = await call('logout', { method: 'POST', cookie: 'buynest_at=1|ACCESS' })
    expect(calls[0].init.headers.Authorization).toBe('Bearer 1|ACCESS')
    expect(response.headers.getSetCookie().every((cookie) => cookie.includes('Max-Age=0'))).toBe(true)
  })

  it('a blocked account (403 on /me) ends the session', async () => {
    fakeUpstream({ 'GET /api/v1/me': { status: 403, body: { message: 'This account has been disabled.', code: 'account_disabled' } } })
    const response = await call('me', { cookie: 'buynest_at=1|ACCESS' })
    expect(response.status).toBe(403)
    expect(response.headers.getSetCookie().every((cookie) => cookie.includes('Max-Age=0'))).toBe(true)
  })

  it('renews with the refresh token', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/auth/refresh': { body: { data: { tokens: { ...TOKENS, access_token: '3|NEW' } } } } })
    const response = await call('refresh', { method: 'POST', cookie: 'buynest_rt=2|REFRESH; buynest_remember=1' })
    expect(sentBody(calls[0])).toEqual({ refresh_token: '2|REFRESH' })
    expect(response.headers.getSetCookie()).toContainEqual(expect.stringMatching(/^buynest_at=3%7CNEW; .*Max-Age=604800/))
  })

  it('admins sign in at the admin API; customers and blocking go through Laravel', async () => {
    const calls = fakeUpstream({
      'POST /api/admin/v1/auth/login': { body: { data: { admin: { id: 1, name: 'Store Admin', email: 'admin@buynest.test' }, tokens: TOKENS } } },
      'GET /api/admin/v1/me': { body: { data: { id: 1, name: 'Store Admin', email: 'admin@buynest.test' } } },
      'GET /api/admin/v1/customers': {
        body: { data: [{ id: 5, first_name: 'Nadia', last_name: 'Rahman', email: 'n@x.co', phone: '+1555', email_verified_at: null, is_active: true, created_at: 'T', last_login_at: null }], meta: { total: 41 } },
      },
      'PATCH /api/admin/v1/customers/5': { body: { data: { id: 5, first_name: 'Nadia', last_name: 'Rahman', email: 'n@x.co', phone: '+1555', email_verified_at: 'T', is_active: false } } },
    })
    const login = await call('auth/login', { service: 'admin', method: 'POST', body: { email: 'admin@buynest.test', password: 'x' } })
    expect(await login.json()).toMatchObject({ name: 'Store Admin', role: 'admin' })
    expect(login.headers.getSetCookie()).toContainEqual(expect.stringMatching(/^buynest_admin_at=1%7CACCESS; Path=\/api\/admin;/))

    const list = await (await call('customers?q=nadia&status=unverified&limit=20&skip=40', { service: 'admin', cookie: 'buynest_admin_at=1|ACCESS' })).json()
    expect(list).toMatchObject({ total: 41, manageable: true, customers: [{ id: 5, firstName: 'Nadia', emailVerified: false, isActive: true }] })
    const listCall = calls.find((entry) => entry.path === '/api/admin/v1/customers')
    expect(listCall.init.headers.Authorization).toBe('Bearer 1|ACCESS')

    const blocked = await call('customers/5', { service: 'admin', method: 'PATCH', cookie: 'buynest_admin_at=1|ACCESS', body: { isActive: false, email: 'x' } })
    expect(await blocked.json()).toMatchObject({ id: 5, isActive: false })
    expect(sentBody(calls.at(-1))).toEqual({ is_active: false })

    const invalid = await call('customers/5', { service: 'admin', method: 'PATCH', cookie: 'buynest_admin_at=1|ACCESS', body: { isActive: 'no' } })
    expect(invalid.status).toBe(422)
  })
})
