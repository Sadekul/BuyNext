import { apiClient } from './apiClient'
import { normalizeUser } from './adapters/dummyJsonAdapter'
import { normalizePhone } from '../utils/validation'

/*
 * Authentication through BuyNest's own sign-in service at /api/auth
 * (server/authBff.js), which talks to the accounts backend
 * (constants/accounts.js): BuyNest's Laravel API, or DummyJSON's demo users.
 * - The browser never receives a token: the service keeps the session in
 *   HttpOnly, Secure, SameSite=Strict cookies, which JavaScript can't read
 *   and the browser sends automatically to /api/auth.
 */

const AUTH = { sameOrigin: true }

/**
 * POST /api/auth/login { email | username, password, remember } → the customer.
 * Wrong credentials → ApiError 422 (Laravel) or 400 (DummyJSON). An account
 * whose email isn't confirmed yet → ApiError 403 with data.code "email_unverified"
 * (a new code has been emailed).
 */
export async function login({ username, email, password, remember }, { signal } = {}) {
  const data = await apiClient.post('/api/auth/login', { username, email, password, remember }, { ...AUTH, signal })
  return normalizeUser(data)
}

/** GET /api/auth/me → the signed-in customer. No or expired session → ApiError 401. */
export async function getCurrentUser({ signal } = {}) {
  return normalizeUser(await apiClient.get('/api/auth/me', { ...AUTH, signal }))
}

/** POST /api/auth/refresh → renews the session cookies using the refresh token cookie. */
export async function refreshSession({ signal } = {}) {
  await apiClient.post('/api/auth/refresh', {}, { ...AUTH, signal })
}

/**
 * POST /api/auth/logout → deletes the session cookies. `keepalive` lets the
 * request finish even if the customer closes or reloads the page right away.
 */
export async function logout() {
  await apiClient.post('/api/auth/logout', {}, { ...AUTH, keepalive: true })
}

/**
 * DummyJSON demo: POST /users/add — SIMULATED. DummyJSON returns the new user
 * with an id but does not save it, so the new account cannot sign in afterwards.
 */
export async function registerDemoCustomer({ firstName, lastName, email, username, password }, { signal } = {}) {
  const data = await apiClient.post('/users/add', { firstName, lastName, email, username, password }, { signal })
  return normalizeUser(data)
}

/**
 * BuyNest accounts: POST /api/auth/register. Creates the account (unconfirmed)
 * and emails a 6-digit code. → { email, expiresIn, resendIn } (seconds).
 * Invalid fields → ApiError 422 with fieldErrors (e.g. { email: [...] }).
 */
export async function registerCustomer({ firstName, lastName, email, phone, password, confirmPassword, acceptTerms }, { signal } = {}) {
  return apiClient.post(
    '/api/auth/register',
    { firstName, lastName, email, phone: normalizePhone(phone), password, confirmPassword, acceptTerms },
    { ...AUTH, signal },
  )
}

/** POST /api/auth/verify-email { email, code, remember } → the customer, now signed in. */
export async function verifyEmail({ email, code, remember }, { signal } = {}) {
  return normalizeUser(await apiClient.post('/api/auth/verify-email', { email, code, remember }, { ...AUTH, signal }))
}

/**
 * POST /api/auth/resend-code → { resendIn }. `purpose`: 'verify_email' | 'reset_password'.
 * The answer is the same whether or not the email has an account.
 */
export async function resendCode({ email, purpose }, { signal } = {}) {
  return apiClient.post('/api/auth/resend-code', { email, purpose }, { ...AUTH, signal })
}

/** POST /api/auth/forgot-password → { resendIn }; a code is emailed if the account exists (same answer either way). */
export async function requestPasswordReset({ email }, { signal } = {}) {
  return apiClient.post('/api/auth/forgot-password', { email }, { ...AUTH, signal })
}

/** POST /api/auth/reset-password { email, code, password, confirmPassword } → signs out every device. */
export async function resetPassword({ email, code, password, confirmPassword }, { signal } = {}) {
  return apiClient.post('/api/auth/reset-password', { email, code, password, confirmPassword }, { ...AUTH, signal })
}

/**
 * PUT /api/auth/profile { firstName, lastName, phone? } or { newsletter } → the updated customer.
 * (`newsletter`, BuyNest accounts only, phase 7: subscribes or unsubscribes at once.)
 * Saved with BuyNest accounts; SIMULATED with DummyJSON (returns the change
 * but forgets it). The account is taken from the session, so customers can
 * only edit their own profile.
 */
export async function updateProfile(changes, { signal } = {}) {
  return normalizeUser(await apiClient.put('/api/auth/profile', changes, { ...AUTH, signal }))
}
