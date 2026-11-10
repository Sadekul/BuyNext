// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

const SITE = 'https://shop.example'

/** Fakes DummyJSON: `routes` maps "METHOD /path" to { status, body }. Records each call. */
function fakeUpstream(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    calls.push({ path: pathname, search, init })
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

describe('catalog and shop (VITE_API_PROVIDER=laravel)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
    vi.stubEnv('VITE_API_PROVIDER', 'laravel')
    vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
  })
  afterEach(() => vi.unstubAllEnvs())

  const sentBody = (entry) => JSON.parse(entry.init.body)
  const PRODUCT = { id: 1, name: 'Mascara', price: '9.99', discount_percent: 10.48, sale_price: '8.94' }
  const TOTALS = { item_count: 2, subtotal: '17.88', discount: '1.79', shipping: '4.99', tax: '0.00', total: '21.08' }
  const LINE = { product_id: 1, sku: 'BEA-1', name: 'Mascara', thumbnail_url: 'https://cdn.dummyjson.com/t.webp', price: '9.99', discount_percent: 10.48, sale_price: '8.94', quantity: 2, line_total: '17.88' }
  const CART = { lines: [{ ...LINE, stock_quantity: 99, min_order_quantity: 1, available: true }], problems: [], coupon: { code: 'NEST10', description: '10% off' }, coupon_error: null, shipping_options: [{ id: 'standard', label: 'Standard', eta: '3–5 days', price: '4.99' }], totals: TOTALS }
  const ADDRESS = { first_name: 'Ava', last_name: 'Customer', line1: '12 Market Street', line2: null, city: 'Springfield', state: 'Oregon', postal_code: '29112', country: 'United States' }
  const ORDER = {
    number: 'BN-100001', status: 'processing', payment_status: 'unpaid', payment_method: 'cod', shipping_method: { id: 'standard', label: 'Standard', eta: '3–5 days' },
    email: 'guest@example.com', phone: '+15550100100', shipping_address: ADDRESS, billing_address: ADDRESS, coupon_code: 'NEST10', items: [LINE], totals: TOTALS,
    placed_at: '2026-11-10T09:41:02Z', history: [{ status: 'processing', payment_status: 'unpaid', note: 'Order placed.', created_at: '2026-11-10T09:41:02Z' }],
  }
  const CHECKOUT = {
    items: [{ productId: 1, quantity: 2, price: 0.01 }], couponCode: 'NEST10', shippingMethod: 'standard', paymentMethod: 'cod', email: 'guest@example.com', phone: '+15550100100',
    shippingAddress: { firstName: 'Ava', lastName: 'Customer', line1: '12 Market Street', line2: '', city: 'Springfield', state: 'Oregon', postalCode: '29112', country: 'United States' },
    billingAddress: null, expectedTotal: 21.08, total: 0.01,
  }

  it('the catalog forwards only allowed paths and query keys, and may be cached for a minute', async () => {
    const meta = { total: 1, path: 'http://laravel.test/api/v1/products', links: [{ url: 'http://laravel.test/secret' }] }
    const calls = fakeUpstream({ 'GET /api/v1/products': { body: { data: [PRODUCT], meta, links: { next: 'http://laravel.test/secret' } } } })
    const response = await call('products?search=mascara&category=beauty&per_page=12&evil=1&brand[]=Essence', { service: 'catalog' })
    expect(response.headers.get('cache-control')).toBe('public, max-age=60')
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ data: [PRODUCT], meta: { total: 1 } })
    expect(text).not.toContain('laravel.test') // the API's internal address never reaches the browser
    expect(new URLSearchParams(calls[0].search).toString()).toBe('search=mascara&category=beauty&brand%5B%5D=Essence&per_page=12')
  })

  it('the catalog is read-only and only knows products and categories', async () => {
    const calls = fakeUpstream({ 'GET /api/v1/products/7': { status: 404, body: { message: 'Product not found.' } } })
    expect((await call('products', { service: 'catalog', method: 'POST', body: {} })).status).toBe(405)
    expect((await call('customers', { service: 'catalog' })).status).toBe(404)
    expect((await call('products/abc', { service: 'catalog' })).status).toBe(404)
    const missing = await call('products/7', { service: 'catalog' })
    expect(missing.status).toBe(404)
    expect(missing.headers.get('cache-control')).toBe('no-store')
    expect(calls.map((entry) => entry.path)).toEqual(['/api/v1/products/7'])
  })

  it('prices a cart from ids and quantities only, and answers in camelCase with numbers', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/cart/validate': { body: { data: CART } } })
    const response = await call('cart/validate', { service: 'shop', method: 'POST', body: { items: [{ productId: 1, quantity: 2, price: 0.01 }], couponCode: 'NEST10', shippingMethod: 'standard' } })
    expect(sentBody(calls[0])).toEqual({ items: [{ product_id: 1, quantity: 2 }], coupon_code: 'NEST10', shipping_method: 'standard' })
    const cart = await response.json()
    expect(cart.totals).toEqual({ itemCount: 2, subtotal: 17.88, discount: 1.79, shipping: 4.99, tax: 0, total: 21.08 })
    expect(cart.lines[0]).toMatchObject({ productId: 1, title: 'Mascara', salePrice: 8.94, lineTotal: 17.88, available: true })
    expect(cart.shippingOptions[0].price).toBe(4.99)
  })

  it('places a guest order without a token, never sending prices from the browser', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/orders': { status: 201, body: { data: ORDER } } })
    const response = await call('orders', { service: 'shop', method: 'POST', body: CHECKOUT })
    expect(response.status).toBe(201)
    const order = await response.json()
    expect(order).toMatchObject({ number: 'BN-100001', status: 'processing', paymentStatus: 'unpaid', email: 'guest@example.com', totals: { total: 21.08 } })
    expect(order.shippingAddress).toEqual({ firstName: 'Ava', lastName: 'Customer', line1: '12 Market Street', line2: '', city: 'Springfield', state: 'Oregon', postalCode: '29112', country: 'United States' })
    expect(order.history[0]).toEqual({ status: 'processing', paymentStatus: 'unpaid', note: 'Order placed.', createdAt: '2026-11-10T09:41:02Z' })
    expect(calls[0].init.headers.Authorization).toBeUndefined()
    const sent = sentBody(calls[0])
    expect(sent.items).toEqual([{ product_id: 1, quantity: 2 }])
    expect(sent.expected_total).toBe('21.08')
    expect(sent.shipping_address).toEqual({ ...ADDRESS })
    expect(JSON.stringify(sent)).not.toMatch(/0\.01/)
  })

  it("places a signed-in customer's order with their token", async () => {
    const calls = fakeUpstream({ 'POST /api/v1/orders': { status: 201, body: { data: ORDER } } })
    await call('orders', { service: 'shop', method: 'POST', body: CHECKOUT, cookie: 'buynest_at=1|ACCESS' })
    expect(calls[0].init.headers.Authorization).toBe('Bearer 1|ACCESS')
  })

  it('passes on "prices changed" (409) with the new cart, and field errors (422) with form names', async () => {
    fakeUpstream({ 'POST /api/v1/orders': { status: 409, body: { message: 'Prices changed since you added these items.', data: CART } } })
    const changed = await call('orders', { service: 'shop', method: 'POST', body: CHECKOUT })
    expect(changed.status).toBe(409)
    expect(await changed.json()).toMatchObject({ code: 'prices_changed', cart: { totals: { total: 21.08 } } })

    fakeUpstream({ 'POST /api/v1/orders': { status: 422, body: { message: 'Invalid', errors: { 'shipping_address.postal_code': ['Enter a postal code.'], payment_method: ['Choose'] }, problems: [{ product_id: 1, code: 'insufficient_stock', message: 'Only 1 left.' }], trace: 'x' } } })
    const invalid = await call('orders', { service: 'shop', method: 'POST', body: CHECKOUT })
    expect(await invalid.json()).toEqual({
      message: 'Invalid',
      errors: { 'shippingAddress.postalCode': ['Enter a postal code.'], paymentMethod: ['Choose'] },
      problems: [{ productId: 1, code: 'insufficient_stock', message: 'Only 1 left.' }],
    })
  })

  it("lists and shows a customer's orders only with the customer session", async () => {
    const calls = fakeUpstream({
      'GET /api/v1/orders': { body: { data: [ORDER], meta: { current_page: 2, per_page: 10, total: 11, last_page: 2 } } },
      'GET /api/v1/orders/BN-100001': { body: { data: ORDER } },
    })
    expect((await call('orders', { service: 'shop' })).status).toBe(401)
    expect((await call('orders/BN-100001', { service: 'shop' })).status).toBe(401)
    expect(calls).toEqual([])

    const list = await (await call('orders?page=2', { service: 'shop', cookie: 'buynest_at=1|ACCESS' })).json()
    expect(list).toMatchObject({ total: 11, page: 2, perPage: 10, lastPage: 2, orders: [{ number: 'BN-100001' }] })
    expect(calls[0].search).toBe('?page=2')
    expect(calls[0].init.headers.Authorization).toBe('Bearer 1|ACCESS')
    expect(await (await call('orders/BN-100001', { service: 'shop', cookie: 'buynest_at=1|ACCESS' })).json()).toMatchObject({ number: 'BN-100001' })
    expect((await call('orders/1%2F..', { service: 'shop', cookie: 'buynest_at=1|ACCESS' })).status).toBe(404)
  })

  it('looks up a guest order by number and email', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/orders/lookup': { status: 404, body: { message: "We couldn't find an order with that number and email." } } })
    const response = await call('orders/lookup', { service: 'shop', method: 'POST', body: { number: ' BN-100001 ', email: 'guest@example.com', extra: 1 } })
    expect(response.status).toBe(404)
    expect(sentBody(calls[0])).toEqual({ number: 'BN-100001', email: 'guest@example.com' })
  })

  it('cart/validate sends the customer token when signed in, and a guest email otherwise', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/cart/validate': { body: { data: { ...CART, coupon: null, coupon_error: "You've already used this code." } } } })
    const guest = await call('cart/validate', { service: 'shop', method: 'POST', body: { items: [{ productId: 1, quantity: 2 }], couponCode: 'NEST10', email: ' ava@example.com ', total: 1 } })
    expect((await guest.json()).couponError).toBe("You've already used this code.")
    expect(sentBody(calls[0])).toEqual({ items: [{ product_id: 1, quantity: 2 }], coupon_code: 'NEST10', shipping_method: 'standard', email: 'ava@example.com' })
    expect(calls[0].init.headers.Authorization).toBeUndefined()

    await call('cart/validate', { service: 'shop', method: 'POST', body: { items: [], couponCode: 'NEST10' }, cookie: 'buynest_at=1|ACCESS' })
    expect(calls[1].init.headers.Authorization).toBe('Bearer 1|ACCESS')
  })

  it('cart/validate is asked again as a guest when the session expired', async () => {
    const calls = fakeUpstream({})
    vi.stubGlobal('fetch', async (url, init = {}) => {
      calls.push({ init })
      const status = init.headers.Authorization ? 401 : 200
      return new Response(JSON.stringify(status === 401 ? { message: 'Unauthenticated.' } : { data: CART }), { status, headers: { 'Content-Type': 'application/json' } })
    })
    const response = await call('cart/validate', { service: 'shop', method: 'POST', body: { items: [] }, cookie: 'buynest_at=old' })
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(2)
  })

  it('orders carry shipments (https tracking links only), invoices, and refunds', async () => {
    const shipped = {
      ...ORDER, status: 'shipped', payment_status: 'partially_refunded', totals: { ...TOTALS, paid: '21.08', refunded: '5.00' },
      shipments: [
        { number: 'SHP-100001', order_number: 'BN-100001', carrier: 'ups', carrier_label: 'UPS', tracking_number: '1Z999', tracking_url: 'https://www.ups.com/track?tracknum=1Z999', created_at: 'T1', admin_name: 'Store Admin', note: null },
        { number: 'SHP-100002', carrier: 'other', carrier_label: 'Other', tracking_number: 'X', tracking_url: 'javascript:alert(1)', created_at: 'T2' },
      ],
      invoices: [{ number: 'INV-100001', amount: '21.08', created_at: 'T0' }],
      credit_memos: [{ number: 'CM-100001', total: '5.00', created_at: 'T3' }],
    }
    fakeUpstream({ 'GET /api/v1/orders/BN-100001': { body: { data: shipped } } })
    const order = await (await call('orders/BN-100001', { service: 'shop', cookie: 'buynest_at=1|ACCESS' })).json()
    expect(order.shipments).toEqual([
      { number: 'SHP-100001', carrier: 'ups', carrierLabel: 'UPS', trackingNumber: '1Z999', trackingUrl: 'https://www.ups.com/track?tracknum=1Z999', createdAt: 'T1' },
      { number: 'SHP-100002', carrier: 'other', carrierLabel: 'Other', trackingNumber: 'X', trackingUrl: null, createdAt: 'T2' },
    ])
    expect(order.invoices).toEqual([{ number: 'INV-100001', amount: 21.08, createdAt: 'T0' }])
    expect(order.creditMemos).toEqual([{ number: 'CM-100001', total: 5, createdAt: 'T3' }])
    expect(order.totals).toMatchObject({ paid: 21.08, refunded: 5 })
    expect(JSON.stringify(order)).not.toContain('Store Admin')
  })

  it("shows a customer's own invoice, only with the session and well-formed numbers", async () => {
    const invoice = { number: 'INV-100001', order_number: 'BN-100001', amount: '21.08', created_at: 'T', admin_name: 'Store Admin', note: 'internal', billing_address: ADDRESS, items: [LINE], totals: TOTALS }
    const calls = fakeUpstream({ 'GET /api/v1/orders/BN-100001/invoices/INV-100001': { body: { data: invoice } } })
    expect((await call('orders/BN-100001/invoices/INV-100001', { service: 'shop' })).status).toBe(401)
    const response = await call('orders/BN-100001/invoices/INV-100001', { service: 'shop', cookie: 'buynest_at=1|ACCESS' })
    const body = await response.json()
    expect(body).toMatchObject({ number: 'INV-100001', orderNumber: 'BN-100001', amount: 21.08, billingAddress: { firstName: 'Ava' }, items: [{ title: 'Mascara', lineTotal: 17.88 }], totals: { total: 21.08 } })
    expect(body).not.toHaveProperty('adminName')
    expect(body).not.toHaveProperty('note')
    expect(calls[0].init.headers.Authorization).toBe('Bearer 1|ACCESS')
    for (const path of ['orders/BN-100001/invoices/CM-1', 'orders/BN-100001/invoices/INV-1/x', 'orders/1/invoices/INV-1', 'orders/BN-100001/shipments/SHP-1']) {
      expect((await call(path, { service: 'shop', cookie: 'buynest_at=1|ACCESS' })).status).toBe(404)
    }
    expect(calls).toHaveLength(1)
  })

  describe('admin data from Laravel', () => {
    const ADMIN_ME = { 'GET /api/admin/v1/me': { body: { data: { id: 1, name: 'Store Admin', email: 'admin@buynest.test' } } } }
    const admin = (action, options = {}) => call(action, { service: 'admin', cookie: 'buynest_admin_at=9|ADMIN', ...options })
    const ADMIN_ORDER = { ...ORDER, id: 1, customer: null, history: [{ ...ORDER.history[0], admin_name: null, customer_notified: false }] }

    it('maps products, with their status, and sends product changes in the API names', async () => {
      const raw = { ...PRODUCT, sku: 'BEA-1', stock_quantity: 4, rating_average: '4.50', category: { slug: 'beauty' }, brand: { name: 'Essence' }, status: 'draft', thumbnail_url: 't.webp' }
      const calls = fakeUpstream({
        ...ADMIN_ME,
        'GET /api/admin/v1/products': { body: { data: [raw], meta: { total: 30 } } },
        'PATCH /api/admin/v1/products/1': { body: { data: { ...raw, price: '12.50' } } },
        'POST /api/admin/v1/products': { status: 422, body: { message: 'Invalid', errors: { name: ['Taken'], stock_quantity: ['Too many'] } } },
      })
      const list = await (await admin('products?q=mas&status=draft&sortBy=title&order=desc&limit=10&skip=20')).json()
      expect(list).toMatchObject({ total: 30, live: true, products: [{ id: 1, title: 'Mascara', category: 'beauty', brand: 'Essence', price: 9.99, stock: 4, status: 'draft' }] })
      expect(Object.fromEntries(new URLSearchParams(calls[1].search))).toEqual({ page: '3', per_page: '10', search: 'mas', status: 'draft', sort: 'name', direction: 'desc' })

      const saved = await (await admin('products/1', { method: 'PUT', body: { price: 12.5, status: 'active', brand: '' } })).json()
      expect(saved).toMatchObject({ product: { price: 12.5 }, live: true })
      expect(sentBody(calls.at(-1))).toEqual({ price: 12.5, status: 'active', brand: null })
      expect((await admin('products/1', { method: 'PUT', body: { status: 'hidden' } })).status).toBe(422)

      const invalid = await admin('products', { method: 'POST', body: { title: 'Lamp', category: 'beauty', price: 1, stock: 1 } })
      expect((await invalid.json()).errors).toEqual({ title: ['Taken'], stock: ['Too many'] })
    })

    it('lists orders with filters, shows one by number, and changes its status', async () => {
      const calls = fakeUpstream({
        ...ADMIN_ME,
        'GET /api/admin/v1/orders': { body: { data: [ADMIN_ORDER], meta: { total: 1 } } },
        'GET /api/admin/v1/orders/BN-100001': { body: { data: ADMIN_ORDER } },
        'PATCH /api/admin/v1/orders/BN-100001': { body: { data: { ...ADMIN_ORDER, status: 'shipped' } } },
      })
      const list = await (await admin('orders?q=ava&status=processing&paymentStatus=unpaid&evil=1')).json()
      expect(list.orders[0]).toMatchObject({ id: 'BN-100001', customer: 'Ava Customer', guest: true, status: 'processing', paymentStatus: 'unpaid', total: 21.08 })
      expect(Object.fromEntries(new URLSearchParams(calls[1].search))).toEqual({ page: '1', per_page: '20', search: 'ava', status: 'processing', payment_status: 'unpaid' })

      const detail = await (await admin('orders/BN-100001')).json()
      expect(detail).toMatchObject({ number: 'BN-100001', customer: { guest: true, firstName: 'Ava', lastName: 'Customer' }, lines: [{ id: 1, title: 'Mascara', quantity: 2, discountedTotal: 17.88 }], history: [{ note: 'Order placed.' }] })

      const shipped = await admin('orders/BN-100001', { method: 'PATCH', body: { status: 'shipped', note: ' Tracking 123 ', notifyCustomer: false, total: 0 } })
      expect((await shipped.json()).status).toBe('shipped')
      expect(sentBody(calls.at(-1))).toEqual({ status: 'shipped', note: 'Tracking 123', notify_customer: false })

      expect((await admin('orders/BN-100001', { method: 'PATCH', body: { paymentStatus: 'unpaid' } })).status).toBe(422)
      expect((await admin('orders/BN-100001', { method: 'PATCH', body: {} })).status).toBe(422)
    })

    it('maps the overview, including orders by status', async () => {
      fakeUpstream({
        ...ADMIN_ME,
        'GET /api/admin/v1/overview': {
          body: {
            data: {
              products: { total: 194, active: 190, out_of_stock: 2, low_stock: 5, inventory_value: '1000.50' },
              orders: { total: 3, revenue: '63.24', units_sold: 6, average_order: '21.08', by_status: { processing: 2, cancelled: 1 } },
              customers: { total: 4 },
              low_stock_products: [{ id: 1, name: 'Mascara', sku: 'BEA-1', category: 'beauty', stock_quantity: 2, thumbnail_url: 't.webp' }],
              latest_orders: [{ number: 'BN-100001', customer_name: null, email: 'guest@example.com', items: 2, total: '21.08', status: 'processing', placed_at: 'T' }],
              low_stock_threshold: 10,
            },
          },
        },
      })
      const overview = await (await admin('overview')).json()
      expect(overview).toMatchObject({
        products: { total: 194, outOfStock: 2, inventoryValue: 1000.5 },
        orders: { revenue: 63.24, averageOrder: 21.08, byStatus: { processing: 2, cancelled: 1 } },
        lowStockProducts: [{ id: 1, title: 'Mascara', category: 'beauty', stock: 2 }],
        latestOrders: [{ id: 'BN-100001', customer: 'guest@example.com', total: 21.08, status: 'processing' }],
        live: true,
      })
    })

    it('invoices and ships an order, forwarding only allowed fields', async () => {
      const invoice = { number: 'INV-100001', order_number: 'BN-100001', amount: '21.08', created_at: 'T', admin_name: 'Store Admin', note: null }
      const shipment = { number: 'SHP-100001', order_number: 'BN-100001', carrier: 'dhl', carrier_label: 'DHL', tracking_number: 'JD0123', tracking_url: 'https://www.dhl.com/en/express/tracking.html?AWB=JD0123', created_at: 'T', admin_name: 'Store Admin', note: 'Box 1' }
      const calls = fakeUpstream({
        ...ADMIN_ME,
        'POST /api/admin/v1/orders/BN-100001/invoices': { status: 201, body: { data: invoice } },
        'POST /api/admin/v1/orders/BN-100001/shipments': { status: 201, body: { data: shipment } },
      })
      const invoiced = await admin('orders/BN-100001/invoices', { method: 'POST', body: { note: ' Paid by transfer ', notifyCustomer: false, amount: 1 } })
      expect(invoiced.status).toBe(201)
      expect(await invoiced.json()).toEqual({ invoice: { number: 'INV-100001', orderNumber: 'BN-100001', amount: 21.08, createdAt: 'T', adminName: 'Store Admin', note: null }, live: true })
      expect(sentBody(calls.at(-1))).toEqual({ note: 'Paid by transfer', notify_customer: false })

      const shipped = await admin('orders/BN-100001/shipments', { method: 'POST', body: { carrier: 'dhl', trackingNumber: ' JD0123 ', note: 'Box 1', status: 'delivered' } })
      expect((await shipped.json()).shipment).toMatchObject({ carrierLabel: 'DHL', trackingNumber: 'JD0123', trackingUrl: expect.stringMatching(/^https:/), adminName: 'Store Admin', note: 'Box 1' })
      expect(sentBody(calls.at(-1))).toEqual({ carrier: 'dhl', tracking_number: 'JD0123', note: 'Box 1', notify_customer: true })

      const before = calls.length
      expect((await admin('orders/BN-100001/shipments', { method: 'POST', body: { carrier: 'pigeon' } })).status).toBe(422)
      expect((await (await admin('orders/BN-100001/shipments', { method: 'POST', body: { carrier: 'ups', trackingNumber: '<script>' } })).json()).errors).toHaveProperty('trackingNumber')
      expect(calls.length - before).toBe(2) // only the session checks: nothing reached the API
    })

    it('passes the API refusal of a second invoice through as a 422 message', async () => {
      fakeUpstream({ ...ADMIN_ME, 'POST /api/admin/v1/orders/BN-100001/invoices': { status: 422, body: { message: 'This order already has an invoice.', errors: { order: ['This order already has an invoice.'] } } } })
      const response = await admin('orders/BN-100001/invoices', { method: 'POST', body: {} })
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ message: 'This order already has an invoice.', errors: { order: ['This order already has an invoice.'] } })
    })

    it('shows refund limits and creates a credit memo with money as strings', async () => {
      const limits = { items: [{ order_item_id: 11, name: 'Mascara', sku: 'BEA-1', ordered: 2, refunded: 0, refundable: 2, unit_refund: '8.04' }], shipping_refundable: '4.99', max_total: '21.08' }
      const memo = { number: 'CM-100001', order_number: 'BN-100001', items: [{ name: 'Mascara', sku: 'BEA-1', quantity: 1, amount: '8.04' }], subtotal: '8.04', shipping_refund: '4.99', adjustment: '-1.00', total: '12.03', restocked: true, created_at: 'T', admin_name: 'Store Admin', note: null }
      const calls = fakeUpstream({
        ...ADMIN_ME,
        'GET /api/admin/v1/orders/BN-100001/refundable': { body: { data: limits } },
        'POST /api/admin/v1/orders/BN-100001/credit-memos': { status: 201, body: { data: memo } },
      })
      expect(await (await admin('orders/BN-100001/refundable')).json()).toEqual({
        items: [{ orderItemId: 11, name: 'Mascara', sku: 'BEA-1', ordered: 2, refunded: 0, refundable: 2, unitRefund: 8.04 }],
        shippingRefundable: 4.99,
        maxTotal: 21.08,
      })
      const created = await admin('orders/BN-100001/credit-memos', {
        method: 'POST',
        body: { items: [{ orderItemId: 11, quantity: 1, amount: 99 }, { orderItemId: 12, quantity: 0 }], shippingRefund: 4.99, adjustment: -1, restock: true, total: 999 },
      })
      expect(created.status).toBe(201)
      expect((await created.json()).creditMemo).toMatchObject({ number: 'CM-100001', shippingRefund: 4.99, adjustment: -1, total: 12.03, restocked: true, items: [{ name: 'Mascara', amount: 8.04 }] })
      expect(sentBody(calls.at(-1))).toEqual({ items: [{ order_item_id: 11, quantity: 1 }], shipping_refund: '4.99', adjustment: '-1.00', restock: true, notify_customer: true })

      expect((await admin('orders/BN-100001/credit-memos', { method: 'POST', body: { items: [], shippingRefund: 0 } })).status).toBe(422)
      expect((await admin('orders/BN-100001/credit-memos', { method: 'POST', body: { items: [{ orderItemId: 11, quantity: 1.5 }] } })).status).toBe(422)
      expect((await admin('orders/BN-100001/credit-memos', { method: 'POST', body: { items: [{ orderItemId: 11, quantity: 1 }], shippingRefund: 1.001 } })).status).toBe(422)
    })

    it('maps API field errors on a credit memo to the form names', async () => {
      fakeUpstream({ ...ADMIN_ME, 'POST /api/admin/v1/orders/BN-100001/credit-memos': { status: 422, body: { message: 'Invalid', errors: { 'items.0.quantity': ['Only 1 can be refunded.'], shipping_refund: ['At most $0.00.'] } } } })
      const response = await admin('orders/BN-100001/credit-memos', { method: 'POST', body: { items: [{ orderItemId: 11, quantity: 2 }], shippingRefund: 1 } })
      expect((await response.json()).errors).toEqual({ 'items.0.quantity': ['Only 1 can be refunded.'], shippingRefund: ['At most $0.00.'] })
    })

    it('lists and shows invoices and credit memos by their numbers only', async () => {
      const invoice = { number: 'INV-100001', order_number: 'BN-100001', amount: '21.08', created_at: 'T', admin_name: 'Store Admin', note: null, billing_address: ADDRESS, items: [LINE], totals: TOTALS }
      const memo = { number: 'CM-100001', order_number: 'BN-100001', items: [], subtotal: '0.00', shipping_refund: '4.99', adjustment: '0.00', total: '4.99', restocked: false, created_at: 'T', admin_name: 'Store Admin', note: null }
      const calls = fakeUpstream({
        ...ADMIN_ME,
        'GET /api/admin/v1/invoices': { body: { data: [invoice], meta: { total: 41 } } },
        'GET /api/admin/v1/invoices/INV-100001': { body: { data: invoice } },
        'GET /api/admin/v1/credit-memos': { body: { data: [memo], meta: { total: 1 } } },
        'GET /api/admin/v1/credit-memos/CM-100001': { body: { data: memo } },
      })
      const list = await (await admin('invoices?q=BN-1&limit=20&skip=40&evil=1')).json()
      expect(list).toMatchObject({ total: 41, live: true, invoices: [{ number: 'INV-100001', orderNumber: 'BN-100001', amount: 21.08 }] })
      expect(Object.fromEntries(new URLSearchParams(calls[1].search))).toEqual({ page: '3', per_page: '20', search: 'BN-1' })
      expect(await (await admin('invoices/INV-100001')).json()).toMatchObject({ number: 'INV-100001', billingAddress: { city: 'Springfield' }, items: [{ title: 'Mascara' }], totals: { total: 21.08 } })
      expect(await (await admin('credit-memos')).json()).toMatchObject({ total: 1, creditMemos: [{ number: 'CM-100001', shippingRefund: 4.99 }] })
      expect(await (await admin('credit-memos/CM-100001')).json()).toMatchObject({ number: 'CM-100001', total: 4.99, restocked: false })

      const before = calls.length
      for (const path of ['invoices/1', 'invoices/CM-100001', 'credit-memos/INV-1', 'orders/BN-1/notes', 'orders/12/invoices', 'invoices/INV-1/x']) {
        expect((await admin(path)).status).toBe(404)
      }
      expect(calls.length).toBe(before) // refused before any session check or upstream call
    })

    it('manages coupons: filters, validation, upper-case codes, and disable vs delete', async () => {
      const coupon = { id: 3, code: 'WINTER5', description: '$5 off', type: 'fixed', value: '5.00', min_subtotal: '25.00', starts_at: null, ends_at: '2026-12-31T23:59:00Z', usage_limit: 100, usage_limit_per_customer: 1, times_used: 0, is_active: true, status: 'active', created_at: 'T', updated_at: 'T' }
      let deleted = 204
      const calls = fakeUpstream({
        ...ADMIN_ME,
        'GET /api/admin/v1/coupons': { body: { data: [coupon], meta: { total: 1 } } },
        'POST /api/admin/v1/coupons': { status: 201, body: { data: coupon } },
        'PATCH /api/admin/v1/coupons/3': { body: { data: { ...coupon, is_active: false, status: 'inactive' } } },
      })
      const list = await (await admin('coupons?status=expired&q=win')).json()
      expect(list.coupons[0]).toEqual({ id: 3, code: 'WINTER5', description: '$5 off', type: 'fixed', value: 5, minSubtotal: 25, startsAt: null, endsAt: '2026-12-31T23:59:00Z', usageLimit: 100, usageLimitPerCustomer: 1, timesUsed: 0, isActive: true, status: 'active', createdAt: 'T', updatedAt: 'T' })
      expect(Object.fromEntries(new URLSearchParams(calls[1].search))).toEqual({ page: '1', per_page: '20', search: 'win', status: 'expired' })
      await admin('coupons?status=used_up')
      expect(new URLSearchParams(calls.at(-1).search).get('status')).toBe('used_up')
      await admin('coupons?status=bogus')
      expect(new URLSearchParams(calls.at(-1).search).has('status')).toBe(false)

      const created = await admin('coupons', { method: 'POST', body: { code: ' winter5 ', description: '$5 off', type: 'fixed', value: 5, minSubtotal: 25, endsAt: '2026-12-31T23:59:00Z', usageLimit: 100, usageLimitPerCustomer: 1, isActive: true, timesUsed: 50 } })
      expect(created.status).toBe(201)
      expect(sentBody(calls.at(-1))).toEqual({ code: 'WINTER5', description: '$5 off', type: 'fixed', value: '5.00', min_subtotal: '25.00', ends_at: '2026-12-31T23:59:00Z', usage_limit: 100, usage_limit_per_customer: 1, is_active: true })

      const invalid = await (await admin('coupons', { method: 'POST', body: { code: 'x', type: 'percent', value: 150, startsAt: '2026-12-01', endsAt: '2026-11-01', description: 'Big' } })).json()
      expect(Object.keys(invalid.errors).sort()).toEqual(['code', 'endsAt', 'value'])
      const free = await admin('coupons', { method: 'POST', body: { code: 'SHIPFREE', description: '', type: 'free_shipping', value: 9 } })
      expect(free.status).toBe(201)
      expect(sentBody(calls.at(-1))).toMatchObject({ value: '0.00', description: null }) // the API writes a description

      const disabled = await admin('coupons/3', { method: 'PATCH', body: { isActive: false } })
      expect((await disabled.json()).coupon).toMatchObject({ isActive: false, status: 'inactive' })
      expect(sentBody(calls.at(-1))).toEqual({ is_active: false })
      expect((await admin('coupons/3', { method: 'PATCH', body: {} })).status).toBe(422)

      vi.stubGlobal('fetch', async (url) => {
        const { pathname } = new URL(url)
        if (pathname === '/api/admin/v1/me') return new Response(JSON.stringify(ADMIN_ME['GET /api/admin/v1/me'].body), { status: 200 })
        return deleted === 204 ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ data: { ...coupon, times_used: 4, is_active: false } }), { status: 200 })
      })
      expect(await (await admin('coupons/3', { method: 'DELETE' })).json()).toEqual({ id: 3, deleted: true, live: true })
      deleted = 200
      expect(await (await admin('coupons/3', { method: 'DELETE' })).json()).toMatchObject({ id: 3, disabled: true, coupon: { timesUsed: 4, isActive: false } })
      expect((await admin('coupons/WINTER5', { method: 'DELETE' })).status).toBe(404)
    })

    it('demo mode refuses order changes and order numbers', async () => {
      vi.stubEnv('VITE_API_PROVIDER', 'dummyjson')
      fakeUpstream(ADMIN_ME)
      expect((await admin('orders/BN-100001', { method: 'PATCH', body: { status: 'shipped' } })).status).toBe(404)
      expect((await admin('orders/BN-100001')).status).toBe(404)
      for (const [path, method] of [['orders/BN-100001/invoices', 'POST'], ['invoices', 'GET'], ['coupons', 'GET'], ['coupons/1', 'DELETE']]) {
        expect((await admin(path, { method, body: method === 'GET' ? undefined : {} })).status).toBe(404)
      }
    })
  })
})
