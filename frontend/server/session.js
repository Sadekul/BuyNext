import { json, upstream } from './http.js'

/*
 * The sign-in session, kept in cookies (see authBff.js for why):
 *   HttpOnly        → page JavaScript (including injected scripts) can't read them
 *   Secure          → HTTPS only (browsers treat http://localhost as secure)
 *   SameSite=Strict → never sent by requests that start on another website
 *   Path=/api       → only sent to BuyNest's services (sign-in and admin)
 * "Remember me" adds Max-Age (7 days); otherwise they are session cookies that
 * end when the browser closes.
 * One more cookie, `buynest_session`, is readable by the page on purpose: it
 * holds no secret, only "a session exists" and whether it is remembered
 * (value `remember` or `session`), with the same lifetime as the session.
 */

export const COOKIES = { access: 'buynest_at', refresh: 'buynest_rt', remember: 'buynest_remember' }
const COOKIE_PATH = '/api'
const LEGACY_COOKIE_PATH = '/api/auth' // used before the admin service existed
const MARKER_COOKIE = 'buynest_session'
export const SHORT_MINUTES = 60
export const REMEMBER_MINUTES = 7 * 24 * 60

function cookie(name, value, maxAgeSeconds, { path = COOKIE_PATH, httpOnly = true } = {}) {
  const lifetime = maxAgeSeconds === undefined ? '' : `; Max-Age=${maxAgeSeconds}`
  return `${name}=${encodeURIComponent(value)}; Path=${path}${httpOnly ? '; HttpOnly' : ''}; Secure; SameSite=Strict${lifetime}`
}

const markerCookie = (value, maxAgeSeconds) => cookie(MARKER_COOKIE, value, maxAgeSeconds, { path: '/', httpOnly: false })

// Expire copies left at the old path, so the browser never sends two sessions.
const legacyCleared = () => Object.values(COOKIES).map((name) => cookie(name, '', 0, { path: LEGACY_COOKIE_PATH }))

export function sessionCookies({ accessToken, refreshToken }, remember) {
  const maxAge = remember ? REMEMBER_MINUTES * 60 : undefined
  return [
    cookie(COOKIES.access, accessToken, maxAge),
    cookie(COOKIES.refresh, refreshToken, maxAge),
    cookie(COOKIES.remember, remember ? '1' : '0', maxAge),
    markerCookie(remember ? 'remember' : 'session', maxAge),
    ...legacyCleared(),
  ]
}

export const clearedCookies = () => [
  ...Object.values(COOKIES).map((name) => cookie(name, '', 0)),
  markerCookie('', 0),
  ...legacyCleared(),
]

export const notSignedIn = () => json({ message: 'Please sign in to continue.' }, 401)

/**
 * Who the session belongs to, asked of DummyJSON with the access token.
 * Resolves to { user } or { response } (an error response to send back).
 */
export async function currentUser(cookies) {
  if (!cookies[COOKIES.access]) return { response: notSignedIn() }
  const { status, data } = await upstream('/auth/me', { token: cookies[COOKIES.access] })
  if (status !== 200) return { response: json({ message: data.message ?? 'Please sign in to continue.' }, status) }
  return { user: data }
}
