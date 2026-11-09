/*
 * BuyNest sign-in service (a small "backend for frontend").
 *
 * Runs on the storefront's own address under /api/auth/*: in `npm run dev`
 * and `npm run preview` (vite.config.js), as a Vercel function
 * (api/auth/[action].js), and as a Netlify function (netlify/functions/auth.mjs).
 *
 * Why: the browser never sees a token. This service signs in with DummyJSON,
 * then keeps the access and refresh tokens in cookies that are
 *   HttpOnly        → page JavaScript (including injected scripts) can't read them
 *   Secure          → HTTPS only (browsers treat http://localhost as secure)
 *   SameSite=Strict → never sent by requests that start on another website
 *   Path=/api/auth  → only sent to this service, not with every request
 * "Remember me" adds Max-Age (7 days); otherwise they are session cookies that
 * end when the browser closes.
 * One more cookie, `buynest_session`, is readable by the page on purpose: it
 * holds no secret, only "a session exists" and whether it is remembered
 * (value `remember` or `session`), with the same lifetime as the session.
 *
 * Endpoints (JSON in, JSON out):
 *   POST /api/auth/login    { username, password, remember } → profile
 *   GET  /api/auth/me                                         → profile
 *   POST /api/auth/refresh                                    → { ok: true }
 *   PUT  /api/auth/profile  { firstName, lastName, email }    → profile
 *   POST /api/auth/logout                                     → { ok: true }
 *
 * Written against the Web standard Request/Response, so the same code runs on
 * Node (Vite), Vercel, and Netlify. With the Laravel backend this file goes
 * away: Sanctum issues the session cookie itself.
 */

const UPSTREAM = 'https://dummyjson.com'
const COOKIE_PATH = '/api/auth'
const COOKIES = { access: 'buynest_at', refresh: 'buynest_rt', remember: 'buynest_remember' }
const MARKER_COOKIE = 'buynest_session' // not HttpOnly: the page's "signed in?" hint
const SHORT_MINUTES = 60
const REMEMBER_MINUTES = 7 * 24 * 60
const PROFILE_FIELDS = ['firstName', 'lastName', 'email']

function json(body, status = 200, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(JSON.stringify(body), { status, headers })
}

function readCookies(request) {
  const cookies = {}
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return cookies
}

function cookie(name, value, maxAgeSeconds, { path = COOKIE_PATH, httpOnly = true } = {}) {
  const lifetime = maxAgeSeconds === undefined ? '' : `; Max-Age=${maxAgeSeconds}`
  return `${name}=${encodeURIComponent(value)}; Path=${path}${httpOnly ? '; HttpOnly' : ''}; Secure; SameSite=Strict${lifetime}`
}

const markerCookie = (value, maxAgeSeconds) => cookie(MARKER_COOKIE, value, maxAgeSeconds, { path: '/', httpOnly: false })

function sessionCookies({ accessToken, refreshToken }, remember) {
  const maxAge = remember ? REMEMBER_MINUTES * 60 : undefined
  return [
    cookie(COOKIES.access, accessToken, maxAge),
    cookie(COOKIES.refresh, refreshToken, maxAge),
    cookie(COOKIES.remember, remember ? '1' : '0', maxAge),
    markerCookie(remember ? 'remember' : 'session', maxAge),
  ]
}

const clearedCookies = () => [...Object.values(COOKIES).map((name) => cookie(name, '', 0)), markerCookie('', 0)]

/** Calls DummyJSON. Resolves to { status, data }; network failures become a 502. */
async function upstream(path, { method = 'GET', token, body } = {}) {
  try {
    const response = await fetch(`${UPSTREAM}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    const data = await response.json().catch(() => ({}))
    return { status: response.status, data }
  } catch {
    return { status: 502, data: { message: 'The sign-in service could not reach the server. Please try again.' } }
  }
}

/** The profile without the tokens DummyJSON puts in the login response. */
function withoutTokens(data) {
  const profile = { ...data }
  delete profile.accessToken
  delete profile.refreshToken
  return profile
}

async function readBody(request) {
  try {
    const body = await request.json()
    return body && typeof body === 'object' ? body : {}
  } catch {
    return {}
  }
}

const notSignedIn = () => json({ message: 'Please sign in to continue.' }, 401)

const ROUTES = {
  async 'POST login'(request) {
    const { username, password, remember } = await readBody(request)
    if (typeof username !== 'string' || typeof password !== 'string') {
      return json({ message: 'Enter your username and password.' }, 400)
    }
    const expiresInMins = remember ? REMEMBER_MINUTES : SHORT_MINUTES
    const { status, data } = await upstream('/auth/login', { method: 'POST', body: { username, password, expiresInMins } })
    if (status !== 200) return json({ message: data.message ?? 'Sign-in failed.' }, status)
    return json(withoutTokens(data), 200, sessionCookies(data, remember === true))
  },

  async 'GET me'(request, cookies) {
    if (!cookies[COOKIES.access]) return notSignedIn()
    const { status, data } = await upstream('/auth/me', { token: cookies[COOKIES.access] })
    return json(status === 200 ? withoutTokens(data) : { message: data.message ?? 'Please sign in to continue.' }, status)
  },

  async 'POST refresh'(request, cookies) {
    if (!cookies[COOKIES.refresh]) return json({ message: 'Your session has expired.' }, 401, clearedCookies())
    const remember = cookies[COOKIES.remember] === '1'
    const { status, data } = await upstream('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: cookies[COOKIES.refresh], expiresInMins: remember ? REMEMBER_MINUTES : SHORT_MINUTES },
    })
    if (status !== 200) {
      // A rejected refresh token ends the session; a server problem doesn't.
      const ended = [400, 401, 403].includes(status)
      return json({ message: data.message ?? 'Your session has expired.' }, status, ended ? clearedCookies() : [])
    }
    return json({ ok: true }, 200, sessionCookies(data, remember))
  },

  // SIMULATED by DummyJSON (returns the change, doesn't save it). The account
  // is taken from the session, so a customer can only edit their own profile.
  async 'PUT profile'(request, cookies) {
    if (!cookies[COOKIES.access]) return notSignedIn()
    const me = await upstream('/auth/me', { token: cookies[COOKIES.access] })
    if (me.status !== 200) return json({ message: me.data.message ?? 'Please sign in to continue.' }, me.status)
    const body = await readBody(request)
    const changes = Object.fromEntries(PROFILE_FIELDS.filter((field) => typeof body[field] === 'string').map((field) => [field, body[field]]))
    const { status, data } = await upstream(`/users/${me.data.id}`, { method: 'PUT', body: changes })
    return json(data, status)
  },

  async 'POST logout'() {
    // DummyJSON has no server-side logout; deleting the cookies ends the session here.
    return json({ ok: true }, 200, clearedCookies())
  },
}

/** Entry point for every host. `action` comes from the URL (/api/auth/<action>) or ?action=. */
export async function handleAuthRequest(request) {
  const url = new URL(request.url)
  const action = url.searchParams.get('action') ?? url.pathname.split('/').filter(Boolean).at(-1)
  const route = ROUTES[`${request.method} ${action}`]
  if (!route) return json({ message: 'Not found.' }, 404)

  // Only this storefront may call the service. Browsers label requests that
  // start on another website "cross-site" (Fetch Metadata), on top of the
  // SameSite=Strict cookies.
  if (request.headers.get('sec-fetch-site') === 'cross-site') return json({ message: 'Forbidden.' }, 403)

  return route(request, readCookies(request))
}
