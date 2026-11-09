import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AuthContext } from './authContext'
import { ApiError, isAbortError } from '../services/apiClient'
import * as authService from '../services/authService'
import { userKeys } from '../queries/userQueries'

/*
 * Who is signed in, for the whole app.
 *
 * LEARNING IMPLEMENTATION — NOT REAL SECURITY:
 * - Tokens are kept in Web Storage so a refresh keeps you signed in. Any
 *   JavaScript on the page (including an XSS attack) can read them.
 * - Hiding pages in React does not protect data: the API must check the
 *   token on every request (it does: /auth/me returns 401 without one).
 * Production plan: Laravel Sanctum with an HttpOnly, Secure, SameSite
 * session cookie that JavaScript can't read, plus CSRF protection.
 *
 * session.status: 'checking' (validating a stored session) | 'authenticated' | 'anonymous'
 */

const STORAGE_KEY = 'buynest.session.v1'
const ANONYMOUS = { status: 'anonymous', user: null, tokens: null, remember: false, expired: false }

// Only these profile fields are written to storage. Phone and address stay in
// memory (pages fetch them fresh from /auth/me), so they don't linger on a
// shared device.
const STORED_USER_FIELDS = ['id', 'username', 'firstName', 'lastName', 'email', 'image']

// Errors that mean "these tokens are no longer valid". Anything else (offline,
// timeout, 5xx, rate limiting) says nothing about the session, so it is kept.
const isAuthFailure = (error) => error instanceof ApiError && [400, 401, 403].includes(error.status)

// "Remember me" → localStorage (survives closing the browser); otherwise
// sessionStorage (cleared when the tab closes).
function readStoredSession() {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const value = JSON.parse(storage.getItem(STORAGE_KEY))
      if (value?.tokens?.accessToken && value?.tokens?.refreshToken && value?.user?.id) return value
    } catch {
      // unreadable entry: ignore it
    }
  }
  return null
}

function writeStoredSession(session) {
  try {
    if (session.status !== 'authenticated') {
      window.localStorage.removeItem(STORAGE_KEY)
      window.sessionStorage.removeItem(STORAGE_KEY)
      return
    }
    const [target, other] = session.remember
      ? [window.localStorage, window.sessionStorage]
      : [window.sessionStorage, window.localStorage]
    // Overwrite in place. Never remove-then-set the key we keep: the removal
    // fires a `storage` event with newValue === null in other tabs, which
    // they (correctly) treat as "signed out".
    other.removeItem(STORAGE_KEY)
    const user = Object.fromEntries(STORED_USER_FIELDS.map((field) => [field, session.user[field] ?? null]))
    target.setItem(STORAGE_KEY, JSON.stringify({ user, tokens: session.tokens, remember: session.remember }))
  } catch {
    // storage blocked: the session simply won't survive a refresh
  }
}

/**
 * Asks the API who the stored tokens belong to. If the access token expired
 * (401), tries ONE refresh. Resolves to a state updater for setSession.
 */
async function verifyStoredSession(tokens, signal) {
  try {
    let currentTokens = tokens
    let user
    try {
      user = await authService.getCurrentUser(currentTokens.accessToken, { signal })
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error
      currentTokens = await authService.refreshSession(currentTokens.refreshToken, { signal })
      user = await authService.getCurrentUser(currentTokens.accessToken, { signal })
    }
    return (current) => ({ ...current, status: 'authenticated', user, tokens: currentTokens })
  } catch (error) {
    if (isAbortError(error)) return (current) => current
    // Auth failures end the session. Network and server problems keep the
    // stored user, because we can't tell whether the session is still valid.
    if (isAuthFailure(error)) return { ...ANONYMOUS, expired: true }
    return (current) => ({ ...current, status: 'authenticated' })
  }
}

function AuthProvider({ children }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState(() => {
    const stored = readStoredSession()
    return stored ? { ...stored, status: 'checking', expired: false } : ANONYMOUS
  })

  // Persist after every change (and remove on sign-out).
  useEffect(() => {
    if (session.status !== 'checking') writeStoredSession(session)
  }, [session])

  // Signed out (by the user, an expired session, or another tab): drop every
  // cached profile so the next person on this device can't see it.
  useEffect(() => {
    if (session.status === 'anonymous') queryClient.removeQueries({ queryKey: userKeys.all })
  }, [session.status, queryClient])

  // Signing out in another tab removes the stored session there → sign out here too.
  useEffect(() => {
    function handleStorage(event) {
      if (event.key === STORAGE_KEY && event.newValue === null) setSession(ANONYMOUS)
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  // Startup check for a stored session (see verifyStoredSession below).
  // The effect applies the result in .then(): setState after the request, never synchronously.
  const checkStoredSession = useEffectEvent((signal) => verifyStoredSession(session.tokens, signal))

  useEffect(() => {
    if (session.status !== 'checking') return
    const controller = new AbortController()
    checkStoredSession(controller.signal).then((update) => {
      if (!controller.signal.aborted) setSession(update)
    })
    return () => controller.abort()
  }, [session.status])

  const login = useCallback(async ({ username, password, remember }) => {
    const { user, tokens } = await authService.login({ username, password })
    setSession({ status: 'authenticated', user, tokens, remember, expired: false })
    return user
  }, [])

  const logout = useCallback(() => {
    // DummyJSON has no logout endpoint. A real backend must also revoke the
    // refresh token / destroy the server session (e.g. POST /logout).
    setSession(ANONYMOUS)
  }, [])

  // The refresh in progress, shared by every request that hit a 401 at the
  // same time: one refresh call, not one per request. (A backend that
  // rotates refresh tokens would reject the second call and sign the user out.)
  const refreshRef = useRef(null)

  /**
   * Runs an authorized request: `request(accessToken)`. On 401 it refreshes
   * the tokens once and retries. If the refresh is rejected, the customer is
   * signed out with `expired: true`; other failures (offline, server error)
   * are re-thrown without signing out.
   */
  const authorizedRequest = useCallback(
    async (request) => {
      if (!session.tokens) throw new ApiError('Please sign in to continue.', { status: 401 })
      try {
        return await request(session.tokens.accessToken)
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error
        const { refreshToken } = session.tokens
        refreshRef.current ??= authService.refreshSession(refreshToken).finally(() => {
          refreshRef.current = null
        })
        let tokens
        try {
          tokens = await refreshRef.current
        } catch (refreshError) {
          if (!isAuthFailure(refreshError)) throw refreshError
          setSession({ ...ANONYMOUS, expired: true })
          throw new ApiError('Your session has expired. Please sign in again.', { status: 401 })
        }
        // Apply the new tokens only to the session they were refreshed for:
        // not after a sign-out, and not over a different account's session.
        setSession((current) =>
          current.status === 'authenticated' && current.tokens?.refreshToken === refreshToken
            ? { ...current, tokens }
            : current,
        )
        return request(tokens.accessToken)
      }
    },
    [session.tokens],
  )

  /** Merges fresh profile data (e.g. from /auth/me) into the session. */
  const updateUser = useCallback((user) => setSession((current) => ({ ...current, user })), [])

  const value = useMemo(
    () => ({
      status: session.status,
      user: session.user,
      isAuthenticated: session.status === 'authenticated',
      sessionExpired: session.expired,
      login,
      logout,
      authorizedRequest,
      updateUser,
    }),
    [session.status, session.user, session.expired, login, logout, authorizedRequest, updateUser],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

export default AuthProvider
