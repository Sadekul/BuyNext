import { json, readBody, safeProfile, upstream } from './http.js'
import {
  COOKIES,
  REMEMBER_MINUTES,
  SHORT_MINUTES,
  clearedCookies,
  currentUser,
  sessionCookies,
} from './session.js'

/*
 * BuyNest sign-in service (a small "backend for frontend"), at /api/auth/*.
 *
 * Why: the browser never sees a token. This service signs in with DummyJSON
 * and keeps the access and refresh tokens in HttpOnly cookies (session.js).
 * It also never forwards more of the profile than the browser needs
 * (safeProfile): DummyJSON's user records include passwords and bank data.
 *
 * Endpoints (JSON in, JSON out):
 *   POST /api/auth/login    { username, password, remember } → profile
 *   GET  /api/auth/me                                         → profile
 *   POST /api/auth/refresh                                    → { ok: true }
 *   PUT  /api/auth/profile  { firstName, lastName, email }    → profile
 *   POST /api/auth/logout                                     → { ok: true }
 *
 * With the Laravel backend this file goes away: Sanctum issues the session
 * cookie itself.
 */

const PROFILE_FIELDS = ['firstName', 'lastName', 'email']

export const AUTH_ROUTES = {
  async 'POST login'(request) {
    const { username, password, remember } = await readBody(request)
    if (typeof username !== 'string' || typeof password !== 'string') {
      return json({ message: 'Enter your username and password.' }, 400)
    }
    const expiresInMins = remember ? REMEMBER_MINUTES : SHORT_MINUTES
    const { status, data } = await upstream('/auth/login', { method: 'POST', body: { username, password, expiresInMins } })
    if (status !== 200) return json({ message: data.message ?? 'Sign-in failed.' }, status)
    // The login reply lacks the role (and contact details): fetch the full
    // profile once, so the app knows straight away whether this is an admin.
    const me = await upstream('/auth/me', { token: data.accessToken })
    const profile = me.status === 200 ? me.data : data
    return json(safeProfile(profile), 200, sessionCookies(data, remember === true))
  },

  async 'GET me'(request, cookies) {
    const { user, response } = await currentUser(cookies)
    return response ?? json(safeProfile(user))
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
    const { user, response } = await currentUser(cookies)
    if (response) return response
    const body = await readBody(request)
    const changes = Object.fromEntries(PROFILE_FIELDS.filter((field) => typeof body[field] === 'string').map((field) => [field, body[field]]))
    const { status, data } = await upstream(`/users/${user.id}`, { method: 'PUT', body: changes })
    return json(status === 200 ? safeProfile(data) : data, status)
  },

  async 'POST logout'() {
    // DummyJSON has no server-side logout; deleting the cookies ends the session here.
    return json({ ok: true }, 200, clearedCookies())
  },
}
