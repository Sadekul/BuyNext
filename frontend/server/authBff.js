import { json, readBody } from './http.js'
import { serverMessage } from './i18n.js'
import { accounts } from './accounts/index.js'
import { CUSTOMER, clearedCookies, notSignedIn, sessionCookies } from './session.js'

/*
 * BuyNest sign-in service for customers (a small "backend for frontend"), at /api/auth/*.
 *
 * Why: the browser never sees a token. This service signs in with the
 * accounts backend (Laravel, or DummyJSON's demo users: accounts/index.js)
 * and keeps the access and refresh tokens in HttpOnly cookies (session.js).
 * It also never forwards more of the profile than the browser needs.
 *
 * Endpoints (JSON in, JSON out):
 *   POST /api/auth/login            { email | username, password, remember } → profile
 *   GET  /api/auth/me                                                        → profile
 *   POST /api/auth/refresh                                                   → { ok: true }
 *   PUT  /api/auth/profile          { firstName, lastName, phone, newsletter?, locale? } → profile
 *                                   (newsletter: Laravel accounts, phase 7; locale 'en' | 'bn': Laravel accounts, phase 13 → PATCH /me)
 *   POST /api/auth/logout                                                    → { ok: true }
 * Laravel accounts only (DummyJSON answers 404):
 *   POST /api/auth/register         { firstName, lastName, email, phone, password, confirmPassword, acceptTerms }
 *                                   → 201 { email, expiresIn, resendIn } and a 6-digit code is emailed
 *   POST /api/auth/verify-email     { email, code, remember } → profile (signed in)
 *   POST /api/auth/resend-code      { email, purpose: verify_email | reset_password }
 *   POST /api/auth/forgot-password  { email }  → a reset code is emailed (same answer for unknown emails)
 *   POST /api/auth/reset-password   { email, code, password, confirmPassword }
 */

const reply = (result, ok) => (result.ok ? ok(result) : json(result.body, result.status))
const signedIn = (remember) => (result) => json(result.profile, 200, sessionCookies(result.tokens, remember, CUSTOMER))

export const AUTH_ROUTES = {
  async 'POST login'(request) {
    const body = await readBody(request)
    const remember = body.remember === true
    return reply(await accounts().customer.login(body, remember, request), signedIn(remember))
  },

  async 'GET me'(request, cookies) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    const result = await accounts().customer.me(cookies[CUSTOMER.access], request)
    // 403 = the account was blocked: its session is over.
    if (!result.ok) return json(result.body, result.status, result.status === 403 ? clearedCookies(CUSTOMER) : [])
    return json(result.profile)
  },

  async 'POST refresh'(request, cookies) {
    if (!cookies[CUSTOMER.refresh]) return json({ message: serverMessage(request, 'sessionExpired') }, 401, clearedCookies(CUSTOMER))
    const remember = cookies[CUSTOMER.remember] === '1'
    const result = await accounts().customer.refresh(cookies[CUSTOMER.refresh], remember, request)
    if (!result.ok) {
      // A rejected refresh token ends the session; a server problem doesn't.
      const ended = [400, 401, 403].includes(result.status)
      return json(result.body, result.status, ended ? clearedCookies(CUSTOMER) : [])
    }
    return json({ ok: true }, 200, sessionCookies(result.tokens, remember, CUSTOMER))
  },

  // The account comes from the session, so a customer can only edit their own profile.
  async 'PUT profile'(request, cookies) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    const result = await accounts().customer.updateProfile(cookies[CUSTOMER.access], await readBody(request), request)
    return reply(result, ({ profile }) => json(profile))
  },

  async 'POST logout'(request, cookies) {
    // Revoke the tokens on the server too (Laravel), then delete the cookies.
    await accounts().customer.logout(cookies[CUSTOMER.access], request)
    return json({ ok: true }, 200, clearedCookies(CUSTOMER))
  },

  async 'POST register'(request) {
    const result = await accounts().customer.register(await readBody(request), request)
    return reply(result, ({ data }) => json(data, 201))
  },

  async 'POST verify-email'(request) {
    const body = await readBody(request)
    const remember = body.remember === true
    return reply(await accounts().customer.verifyEmail(body, remember, request), signedIn(remember))
  },

  async 'POST resend-code'(request) {
    return reply(await accounts().customer.resendCode(await readBody(request), request), ({ data }) => json(data))
  },

  async 'POST forgot-password'(request) {
    return reply(await accounts().customer.forgotPassword(await readBody(request), request), ({ data }) => json(data))
  },

  async 'POST reset-password'(request) {
    return reply(await accounts().customer.resetPassword(await readBody(request), request), ({ data }) => json(data))
  },
}
