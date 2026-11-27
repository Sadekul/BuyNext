import { api } from '../api/client'
import { REAL_ACCOUNTS } from './accounts'

/*
 * The admin session lives in its own HttpOnly cookies, set by the admin
 * service (/api/admin/auth/*), separate from the storefront's customer
 * session. These helpers only read the session's readable hint cookie and keep
 * other admin tabs in step.
 */

const HINT_COOKIE = 'buynest_admin_session'
// Other admin tabs listen for this key and check their session again.
export const ADMIN_SIGNAL = 'buynest.admin.signal'

export const hasSession = () => document.cookie.split('; ').some((entry) => entry.startsWith(`${HINT_COOKIE}=`) && entry.length > HINT_COOKIE.length + 1)

function notifyOtherTabs() {
  try {
    window.localStorage.setItem(ADMIN_SIGNAL, String(Date.now()))
  } catch {
    // storage blocked: other tabs notice at their next request
  }
}

/**
 * Who is signed in to the admin? Resolves to one of
 *   { status: 'admin', user } | { status: 'forbidden', user: null } | { status: 'signedOut' }.
 * The server decides: GET /api/admin/me checks the admin session.
 */
export async function checkAdminSession({ signal } = {}) {
  if (!hasSession()) return { status: 'signedOut' }
  try {
    return { status: 'admin', user: await api.get('/api/admin/me', { signal }) }
  } catch (error) {
    if (error.status === 403) return { status: 'forbidden', user: null }
    if (error.status === 401) return { status: 'signedOut' }
    throw error
  }
}

/**
 * After a sign-in answer that set the session: tell other tabs, and load the role and permissions.
 * The sign-in answer has no role or permissions; /me has them (BuyNest accounts). If /me can't be
 * loaded (a slow or busy server), try twice more, then fail closed: an empty permission list hides
 * every screen and button that needs one until the page is reloaded. Returning the sign-in answer
 * as it was would have shown everything, since "no list" means "show all" for demo accounts
 * (found by the customers suite under a full run: a Viewer briefly saw Create order and bulk actions).
 */
async function signedIn(user) {
  notifyOtherTabs()
  if (!REAL_ACCOUNTS || user?.permissions) return user
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await api.get('/api/admin/me')
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) throw error
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  return { ...user, permissions: [], permissionsUnavailable: true }
}

/**
 * POST /api/admin/auth/login → the admin. Customer accounts are refused by the server.
 * Phase 9: with two-step sign-in on, the answer is { twoFactorRequired, challenge, expiresAt }
 * instead (no session yet): returned as it is, for the second step.
 */
export async function startSession(credentials) {
  const answer = await api.post('/api/admin/auth/login', credentials)
  if (answer?.twoFactorRequired === true) return answer
  return signedIn(answer)
}

/** Phase 9: the second step, { challenge, code | recoveryCode, remember } → the admin (session cookies set). */
export async function finishTwoFactor(body) {
  return signedIn(await api.post('/api/admin/auth/two-factor', body))
}

/** Ends the admin session: cookies and tokens (server), the hint (here), other admin tabs (signal). */
export function endSession() {
  document.cookie = `${HINT_COOKIE}=; Max-Age=0; Path=/; Secure; SameSite=Strict`
  api.post('/api/admin/auth/logout', {}, { keepalive: true }).catch(() => {})
  notifyOtherTabs()
}
