import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AdminAuthContext } from './adminAuthContext'
import { STOREFRONT_PROFILE, SIGN_OUT_SIGNAL, checkAdminSession, endSession } from './session'
import { ApiError, api } from '../api/client'

/*
 * Admin sign-in state for the whole dashboard.
 *   status: 'checking' | 'signedOut' | 'forbidden' (signed in, not an admin) | 'admin' | 'error'
 *
 * Hiding screens here is only for convenience: the admin service checks the
 * account's role on every request, so a customer gets 403 from the API
 * even if they reach a page.
 */
function AdminAuthProvider({ children }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState({ status: 'checking', user: null })

  // Check the session on start, and whenever a storefront tab signs in or out.
  useEffect(() => {
    let controller = new AbortController()
    const check = () => {
      checkAdminSession({ signal: controller.signal }).then(
        (result) => !controller.signal.aborted && setSession({ user: null, ...result }),
        (error) => !controller.signal.aborted && setSession({ status: 'error', user: null, message: error.message }),
      )
    }
    check()
    function handleStorage(event) {
      if (event.key !== SIGN_OUT_SIGNAL && event.key !== STOREFRONT_PROFILE) return
      controller.abort()
      controller = new AbortController()
      check()
    }
    window.addEventListener('storage', handleStorage)
    return () => {
      controller.abort()
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  /** Signs in, then lets the server decide whether this account is an admin. */
  const signIn = useCallback(async ({ username, password, remember }) => {
    await api.post('/api/auth/login', { username, password, remember })
    try {
      const user = await api.get('/api/admin/me')
      setSession({ status: 'admin', user })
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        endSession() // a customer account: don't leave it signed in from the admin page
        throw new ApiError('This account is not a shop admin. Sign in with an admin account.', { status: 403 })
      }
      throw error
    }
  }, [])

  const signOut = useCallback(() => {
    endSession()
    queryClient.clear() // nothing from this session stays in memory
    setSession({ status: 'signedOut', user: null })
  }, [queryClient])

  const value = useMemo(() => ({ ...session, signIn, signOut }), [session, signIn, signOut])
  return <AdminAuthContext value={value}>{children}</AdminAuthContext>
}

export default AdminAuthProvider
