import { json } from './http.js'
import { serverMessage } from './i18n.js'

/*
 * Sign-in sessions, kept in cookies (see authBff.js for why):
 *   HttpOnly        → page JavaScript (including injected scripts) can't read them
 *   Secure          → HTTPS only (browsers treat http://localhost as secure)
 *   SameSite=Strict → never sent by requests that start on another website
 *   Path            → only sent to BuyNest's services
 * "Keep me signed in" adds Max-Age (7 days); otherwise they are session
 * cookies that end when the browser closes.
 *
 * Customers and admins have SEPARATE sessions (different cookie names), like
 * separate accounts: signing in on the storefront never signs anyone in to
 * the admin dashboard, and the other way round.
 *
 * One more cookie per session is readable by the page on purpose: it holds no
 * secret, only "a session exists" and whether it is remembered (value
 * `remember` or `session`), with the same lifetime as the session.
 */

export const CUSTOMER = {
  access: 'buynest_at',
  refresh: 'buynest_rt',
  remember: 'buynest_remember',
  marker: 'buynest_session',
  path: '/api',
  legacyPath: '/api/auth', // used before the admin service existed
}
export const ADMIN = {
  access: 'buynest_admin_at',
  refresh: 'buynest_admin_rt',
  remember: 'buynest_admin_remember',
  marker: 'buynest_admin_session',
  path: '/api/admin',
}
/** Customer cookie names (kept for older imports). */
export const COOKIES = { access: CUSTOMER.access, refresh: CUSTOMER.refresh, remember: CUSTOMER.remember }

export const SHORT_MINUTES = 60
export const REMEMBER_MINUTES = 7 * 24 * 60

function cookie(name, value, maxAgeSeconds, { path, httpOnly = true }) {
  const lifetime = maxAgeSeconds === undefined ? '' : `; Max-Age=${maxAgeSeconds}`
  return `${name}=${encodeURIComponent(value)}; Path=${path}${httpOnly ? '; HttpOnly' : ''}; Secure; SameSite=Strict${lifetime}`
}

const secretNames = (kind) => [kind.access, kind.refresh, kind.remember]
const markerCookie = (kind, value, maxAgeSeconds) => cookie(kind.marker, value, maxAgeSeconds, { path: '/', httpOnly: false })
// Expire copies left at an old path, so the browser never sends two sessions.
const legacyCleared = (kind) => (kind.legacyPath ? secretNames(kind).map((name) => cookie(name, '', 0, { path: kind.legacyPath })) : [])

/** The Set-Cookie headers for a new or renewed session. */
export function sessionCookies({ accessToken, refreshToken }, remember, kind = CUSTOMER) {
  const maxAge = remember ? REMEMBER_MINUTES * 60 : undefined
  return [
    cookie(kind.access, accessToken, maxAge, kind),
    cookie(kind.refresh, refreshToken, maxAge, kind),
    cookie(kind.remember, remember ? '1' : '0', maxAge, kind),
    markerCookie(kind, remember ? 'remember' : 'session', maxAge),
    ...legacyCleared(kind),
  ]
}

/** The Set-Cookie headers that end a session. */
export const clearedCookies = (kind = CUSTOMER) => [
  ...secretNames(kind).map((name) => cookie(name, '', 0, kind)),
  markerCookie(kind, '', 0),
  ...legacyCleared(kind),
]

// Phase 13: in the shopper's language when the request is given (server/i18n.js).
export const notSignedIn = (request) => json({ message: serverMessage(request, 'signIn') }, 401)
