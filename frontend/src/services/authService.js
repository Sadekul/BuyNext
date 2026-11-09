import { apiClient } from './apiClient'
import { normalizeUser } from './adapters/dummyJsonAdapter'

/*
 * Authentication through BuyNest's own sign-in service at /api/auth
 * (server/authBff.js), which talks to DummyJSON's demo auth API.
 * - Demo accounts come from https://dummyjson.com/users (e.g. emilys / emilyspass).
 * - The browser never receives a token: the service keeps the session in
 *   HttpOnly, Secure, SameSite=Strict cookies, which JavaScript can't read
 *   and the browser sends automatically to /api/auth.
 * With Laravel Sanctum the backend issues that session cookie itself.
 */

const AUTH = { sameOrigin: true }

/** POST /api/auth/login → the customer. Wrong credentials → ApiError 400 "Invalid credentials". */
export async function login({ username, password, remember }, { signal } = {}) {
  const data = await apiClient.post('/api/auth/login', { username, password, remember }, { ...AUTH, signal })
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
 * POST /users/add — SIMULATED: DummyJSON returns the new user with an id
 * but does not save it, so the new account cannot sign in afterwards.
 */
export async function registerCustomer({ firstName, lastName, email, username, password }, { signal } = {}) {
  const data = await apiClient.post('/users/add', { firstName, lastName, email, username, password }, { signal })
  return normalizeUser(data)
}

/**
 * PUT /api/auth/profile — SIMULATED: DummyJSON returns the updated user but
 * does not save it, so the change disappears after a reload. The account is
 * taken from the session, so customers can only edit their own profile.
 */
export async function updateProfile(changes, { signal } = {}) {
  return normalizeUser(await apiClient.put('/api/auth/profile', changes, { ...AUTH, signal }))
}
