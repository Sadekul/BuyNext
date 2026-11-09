// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { handleAuthRequest } from './authBff'

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

const call = (action, { method = 'GET', body, cookie, site = 'same-origin' } = {}) =>
  handleAuthRequest(
    new Request(`${SITE}/api/auth/${action}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': site, ...(cookie && { Cookie: cookie }) },
      body: body && JSON.stringify(body),
    }),
  )

const LOGIN_OK = { 'POST /auth/login': { body: { id: 1, firstName: 'Emily', accessToken: 'AT', refreshToken: 'RT' } } }

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
    expect(access).toMatch(/Path=\/api\/auth/)
    expect(access).not.toMatch(/Max-Age/) // not remembered: ends when the browser closes
    const hint = cookies.find((cookie) => cookie.startsWith('buynest_session='))
    expect(hint).not.toMatch(/HttpOnly/) // the readable hint
    expect(hint).toMatch(/^buynest_session=session;/)
  })

  it('"Remember me" makes the cookies last 7 days', async () => {
    const calls = fakeUpstream(LOGIN_OK)
    const response = await call('login', { method: 'POST', body: { username: 'emilys', password: 'x', remember: true } })
    expect(response.headers.getSetCookie().every((cookie) => cookie.includes('Max-Age=604800'))).toBe(true)
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
    expect(cookies).toHaveLength(4)
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
