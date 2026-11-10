import { ApiError, api } from '../api/client'

/*
 * The admin app shares the storefront's sign-in session (HttpOnly cookies,
 * set by the sign-in service). These helpers only read the session's
 * readable hint cookie and tell storefront tabs about a sign-out.
 */

const HINT_COOKIE = 'buynest_session'
// Storefront tabs listen for this key (frontend AuthProvider) and sign out too.
export const SIGN_OUT_SIGNAL = 'buynest.signal.signout'
// The storefront's cached profile; it changes when the storefront signs in or out.
export const STOREFRONT_PROFILE = 'buynest.session.v2'

export const hasSession = () => document.cookie.split('; ').some((entry) => entry.startsWith(`${HINT_COOKIE}=`) && entry.length > HINT_COOKIE.length + 1)

/**
 * Who is signed in, and are they an admin? Resolves to one of
 *   { status: 'admin', user } | { status: 'forbidden', user } | { status: 'signedOut' }.
 * The server decides: GET /api/admin/me answers 403 for non-admin accounts.
 */
export async function checkAdminSession({ signal } = {}) {
  if (!hasSession()) return { status: 'signedOut' }
  try {
    return { status: 'admin', user: await api.get('/api/admin/me', { signal }) }
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      const user = await api.get('/api/auth/me', { signal }).catch(() => null)
      return { status: 'forbidden', user }
    }
    if (error instanceof ApiError && error.status === 401) return { status: 'signedOut' }
    throw error
  }
}

/** Ends the shared session: cookies (server), the hint (here), and storefront tabs (signal). */
export function endSession() {
  document.cookie = `${HINT_COOKIE}=; Max-Age=0; Path=/; Secure; SameSite=Strict`
  api.post('/api/auth/logout', {}, { keepalive: true }).catch(() => {})
  try {
    window.localStorage.setItem(SIGN_OUT_SIGNAL, String(Date.now()))
  } catch {
    // storage blocked: storefront tabs notice at their next request
  }
}
