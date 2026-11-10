// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
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

const call = (action, { method = 'GET', body, cookie, site = 'same-origin', service = 'auth' } = {}) =>
  handleApiRequest(
    new Request(`${SITE}/api/${service}/${action}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': site, ...(cookie && { Cookie: cookie }) },
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
  const admin = (action, options = {}) => call(action, { service: 'admin', cookie: 'buynest_at=AT', ...options })

  it('refuses visitors without a session (401) and customer accounts (403) on every route', async () => {
    fakeUpstream({ 'GET /auth/me': { body: { id: 16, role: 'user' } } })
    const routes = [['overview'], ['products'], ['products/1'], ['products', 'POST'], ['products/1', 'PUT'], ['products/1', 'DELETE'], ['orders'], ['orders/1'], ['customers'], ['categories'], ['me']]
    for (const [action, method = 'GET'] of routes) {
      expect((await call(action, { service: 'admin', method })).status).toBe(401)
      expect((await admin(action, { method, body: method === 'GET' || method === 'DELETE' ? undefined : {} })).status).toBe(403)
    }
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
  })
})
