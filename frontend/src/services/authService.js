import { apiClient } from './apiClient'
import { normalizeTokens, normalizeUser } from './adapters/dummyJsonAdapter'

/*
 * Authentication against DummyJSON's demo auth API (LEARNING ONLY).
 * - Demo accounts come from https://dummyjson.com/users (e.g. emilys / emilyspass).
 * - Tokens are JWTs. DummyJSON also sets cookies, but BuyNest sends the token
 *   in the Authorization header so you can see the pattern in DevTools.
 * In production (Laravel Sanctum) the session would live in an HttpOnly,
 * Secure, SameSite cookie that JavaScript cannot read. See docs/phases/phase-09.
 */

const SESSION_MINUTES = 60

function authHeader(accessToken) {
  return { Authorization: `Bearer ${accessToken}` }
}

/** POST /auth/login → { user, tokens }. Wrong credentials → ApiError 400 "Invalid credentials". */
export async function login({ username, password }, { signal } = {}) {
  const data = await apiClient.post('/auth/login', { username, password, expiresInMins: SESSION_MINUTES }, { signal })
  return { user: normalizeUser(data), tokens: normalizeTokens(data) }
}

/** GET /auth/me → the signed-in customer. Missing/expired token → ApiError 401. */
export async function getCurrentUser(accessToken, { signal } = {}) {
  const data = await apiClient.get('/auth/me', { headers: authHeader(accessToken), signal })
  return normalizeUser(data)
}

/** POST /auth/refresh → new tokens, using the long-lived refresh token. */
export async function refreshSession(refreshToken, { signal } = {}) {
  const data = await apiClient.post('/auth/refresh', { refreshToken, expiresInMins: SESSION_MINUTES }, { signal })
  return normalizeTokens(data)
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
 * PUT /users/:id — SIMULATED: DummyJSON returns the updated user but does not
 * save it, so the change disappears after a reload.
 */
export async function updateProfile(accessToken, userId, changes, { signal } = {}) {
  const data = await apiClient.put(`/users/${userId}`, changes, { headers: authHeader(accessToken), signal })
  return normalizeUser(data)
}
