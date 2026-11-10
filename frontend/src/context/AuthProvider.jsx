import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AuthContext } from './authContext'
import { ApiError, isAbortError } from '../services/apiClient'
import * as authService from '../services/authService'
import { userKeys } from '../queries/userQueries'
import { LEGACY_KEYS, STORAGE_KEYS } from '../constants/storageKeys'
import { removeAccountData } from '../utils/accountData'
import { readJson, removeKey, writeJson } from '../utils/storage'

/*
 * Who is signed in, for the whole app.
 *
 * The session lives in HttpOnly cookies set by BuyNest's sign-in service
 * (server/authBff.js): no token ever reaches JavaScript or Web Storage, so an
 * injected script can't steal one. The browser sends the cookies to /api/auth
 * by itself.
 *
 * What the page DOES keep:
 * - the `buynest_session` cookie: a readable hint (no secret) that a session
 *   exists and whether it is remembered (`remember` / `session`), set by the
 *   server together with the session, so the two always agree;
 * - the customer's name and avatar in localStorage (STORAGE_KEYS.profile), so
 *   the header can greet them before /api/auth/me answers. Only trusted while
 *   the hint cookie exists.
 * Hiding pages in React is still not security: the API checks the session
 * cookie on every request.
 *
 * session.status: 'checking' (validating a session) | 'authenticated' | 'anonymous'
 * session.remember: "Remember me" — keeps the account's saved items on this
 * device after the session ends; otherwise they are deleted (accountData.js).
 */

const ANONYMOUS = { status: 'anonymous', user: null, remember: false, expired: false }
const SESSION_HINT_COOKIE = 'buynest_session'

// Only these profile fields are written to storage. Phone and address stay in
// memory (pages fetch them fresh from /api/auth/me).
const STORED_USER_FIELDS = ['id', 'username', 'firstName', 'lastName', 'email', 'image', 'role']

// Errors that mean "this session is no longer valid". Anything else (offline,
// timeout, 5xx, rate limiting) says nothing about the session, so it is kept.
const isAuthFailure = (error) => error instanceof ApiError && [400, 401, 403].includes(error.status)

/** The session hint cookie: null when there is no session, else { remember }. */
function readSessionHint() {
  const entry = document.cookie.split('; ').find((item) => item.startsWith(`${SESSION_HINT_COOKIE}=`))
  const value = entry?.slice(SESSION_HINT_COOKIE.length + 1)
  return value ? { remember: value === 'remember' } : null
}

function readCachedProfile() {
  const cached = readJson(STORAGE_KEYS.profile, null)
  return Number.isInteger(cached?.user?.id) ? { user: cached.user, remember: cached.remember === true } : null
}

/**
 * The starting state, from the hint cookie and the cached profile. Also tidies
 * up after sessions that ended while the app was closed: an unremembered
 * session ends when the browser closes, so its account data is deleted here.
 */
function initialSession() {
  LEGACY_KEYS.forEach((key) => {
    removeKey(key) // older versions kept tokens in Web Storage
    try {
      window.sessionStorage.removeItem(key)
    } catch {
      // storage blocked: nothing to remove
    }
  })
  const cached = readCachedProfile()
  const hint = readSessionHint()
  if (hint) return { status: 'checking', user: cached?.user ?? null, remember: hint.remember, expired: false }
  if (cached) {
    if (!cached.remember) removeAccountData(cached.user.id)
    removeKey(STORAGE_KEYS.profile)
  }
  return ANONYMOUS
}

/**
 * Asks the sign-in service who the session belongs to. If it has expired
 * (401), renews it ONCE. Resolves to a state updater for setSession.
 */
async function verifySession(signal) {
  try {
    let user
    try {
      user = await authService.getCurrentUser({ signal })
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error
      await authService.refreshSession({ signal })
      user = await authService.getCurrentUser({ signal })
    }
    return (current) => ({ ...current, status: 'authenticated', user })
  } catch (error) {
    if (isAbortError(error)) return (current) => current
    if (isAuthFailure(error)) return { ...ANONYMOUS, expired: true }
    // Offline or a server problem: keep the customer we know about, if any.
    return (current) => (current.user ? { ...current, status: 'authenticated' } : ANONYMOUS)
  }
}

function AuthProvider({ children }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState(initialSession)

  // Cache the name/avatar while signed in; remove it when signed out.
  useEffect(() => {
    if (session.status === 'authenticated') {
      const user = Object.fromEntries(STORED_USER_FIELDS.map((field) => [field, session.user[field] ?? null]))
      writeJson(STORAGE_KEYS.profile, { user, remember: session.remember })
    } else if (session.status === 'anonymous') {
      removeKey(STORAGE_KEYS.profile)
    }
  }, [session])

  // When a session ends (sign-out, expiry, or sign-out in another tab):
  // - drop every cached profile so the next person can't see it;
  // - without "Remember me", delete the account's saved cart, wishlist, and
  //   orders from this device. This runs after the stores have switched to the
  //   guest copies, so nothing writes the account's data back.
  const previousSessionRef = useRef(session)
  useEffect(() => {
    const previous = previousSessionRef.current
    previousSessionRef.current = session
    if (session.status !== 'anonymous') return
    queryClient.removeQueries({ queryKey: userKeys.all })
    if (previous.user && !previous.remember) removeAccountData(previous.user.id)
  }, [session, queryClient])

  // Keep every tab on the same account. Cookies are shared by all tabs; the
  // cached profile's `storage` event tells the other tabs what happened.
  // (The admin dashboard has its own, separate session.)
  useEffect(() => {
    function handleStorage(event) {
      if (event.key !== STORAGE_KEYS.profile) return
      const cached = readCachedProfile()
      const hint = readSessionHint()
      if (!cached || !hint) {
        setSession((current) => (current.status === 'anonymous' ? current : ANONYMOUS))
        return
      }
      setSession((current) =>
        current.status !== 'anonymous' && current.user?.id === cached.user.id
          ? current
          : { status: 'checking', user: cached.user, remember: hint.remember, expired: false },
      )
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  // Session check on start-up (and when another tab signs in).
  // The effect applies the result in .then(): setState after the request, never synchronously.
  const checkSession = useEffectEvent((signal) => verifySession(signal))

  useEffect(() => {
    if (session.status !== 'checking') return
    const controller = new AbortController()
    checkSession(controller.signal).then((update) => {
      if (!controller.signal.aborted) setSession(update)
    })
    return () => controller.abort()
  }, [session.status])

  const login = useCallback(async ({ username, email, password, remember }) => {
    const user = await authService.login({ username, email, password, remember })
    setSession({ status: 'authenticated', user, remember, expired: false })
    return user
  }, [])

  /** Confirms a new account with the emailed code; the customer is then signed in. */
  const verifyEmail = useCallback(async ({ email, code, remember }) => {
    const user = await authService.verifyEmail({ email, code, remember })
    setSession({ status: 'authenticated', user, remember, expired: false })
    return user
  }, [])

  const logout = useCallback(() => {
    // 1. Delete the readable hint now: even if the page reloads before the
    //    request below finishes, the app starts signed out.
    // 2. The service deletes the HttpOnly session cookies (a keepalive request,
    //    so closing the tab doesn't cancel it).
    document.cookie = `${SESSION_HINT_COOKIE}=; Max-Age=0; Path=/; Secure; SameSite=Strict`
    authService.logout().catch(() => {})
    setSession(ANONYMOUS)
  }, [])

  // The renewal in progress, shared by every request that hit a 401 at the
  // same time: one refresh call, not one per request.
  const refreshRef = useRef(null)

  /**
   * Runs a request that needs the session: `request()`. On 401 it renews the
   * session once and retries. If renewal is rejected, the customer is signed
   * out with `expired: true`; other failures (offline, server error) are
   * re-thrown without signing out.
   */
  const authorizedRequest = useCallback(
    async (request) => {
      if (session.status === 'anonymous') throw new ApiError('Please sign in to continue.', { status: 401 })
      try {
        return await request()
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error
        refreshRef.current ??= authService.refreshSession().finally(() => {
          refreshRef.current = null
        })
        try {
          await refreshRef.current
        } catch (refreshError) {
          if (!isAuthFailure(refreshError)) throw refreshError
          setSession((current) => (current.status === 'anonymous' ? current : { ...ANONYMOUS, expired: true }))
          throw new ApiError('Your session has expired. Please sign in again.', { status: 401 })
        }
        return request()
      }
    },
    [session.status],
  )

  /** Merges fresh profile data (e.g. a renamed customer) into the session. */
  const updateUser = useCallback((user) => setSession((current) => ({ ...current, user })), [])

  const value = useMemo(
    () => ({
      status: session.status,
      user: session.user,
      isAuthenticated: session.status === 'authenticated',
      sessionExpired: session.expired,
      login,
      verifyEmail,
      logout,
      authorizedRequest,
      updateUser,
    }),
    [session.status, session.user, session.expired, login, verifyEmail, logout, authorizedRequest, updateUser],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

export default AuthProvider
