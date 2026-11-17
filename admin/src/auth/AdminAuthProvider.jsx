import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AdminAuthContext } from './adminAuthContext'
import { api } from '../api/client'
import { ADMIN_SIGNAL, checkAdminSession, endSession, finishTwoFactor, startSession } from './session'

/*
 * Admin sign-in state for the whole dashboard.
 *   status: 'checking' | 'signedOut' | 'forbidden' (the server refused this session) | 'admin' | 'error'
 *   can(key): whether the admin's role has a permission ("orders.edit"), for hiding screens and buttons
 *
 * Hiding screens here is only for convenience: the admin service checks the
 * admin session on every request, so anyone else gets 401/403 from the API
 * even if they reach a page.
 */
function AdminAuthProvider({ children }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState({ status: 'checking', user: null })

  // Check the session on start, and whenever another admin tab signs in or out.
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
      if (event.key !== ADMIN_SIGNAL) return
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

  /**
   * Signs in with an admin account. The server refuses customer accounts.
   * Resolves to null when signed in, or (phase 9, two-step on) to
   * { twoFactorRequired, challenge, expiresAt } for the second step.
   */
  const signIn = useCallback(async (credentials) => {
    const result = await startSession(credentials)
    if (result?.twoFactorRequired === true) return result
    setSession({ status: 'admin', user: result })
    return null
  }, [])

  /** Phase 9: the second sign-in step (a code from the app, or a recovery code). */
  const verifyTwoFactor = useCallback(async (body) => {
    const user = await finishTwoFactor(body)
    setSession({ status: 'admin', user })
  }, [])

  /** Phase 9: loads the profile again (after turning two-step on or off). */
  const reloadUser = useCallback(async () => {
    const user = await api.get('/api/admin/me')
    setSession((current) => ({ ...current, status: 'admin', user }))
    return user
  }, [])

  const signOut = useCallback(() => {
    endSession()
    queryClient.clear() // nothing from this session stays in memory
    setSession({ status: 'signedOut', user: null })
  }, [queryClient])

  // What the role allows (phase 4). Without a permission list (demo accounts,
  // an older API) everything shows; the server refuses what isn't allowed either way.
  const permissions = session.user?.permissions
  const can = useCallback((key) => !Array.isArray(permissions) || permissions.includes(key), [permissions])

  // Phase 9: the Owner (two-step settings and resets). The API checks it too.
  const isOwner = session.user?.isOwner ?? (typeof session.user?.role === 'object' && session.user.role?.name === 'Owner')

  const value = useMemo(
    () => ({ ...session, signIn, signOut, can, isOwner, verifyTwoFactor, reloadUser }),
    [session, signIn, signOut, can, isOwner, verifyTwoFactor, reloadUser],
  )
  return <AdminAuthContext value={value}>{children}</AdminAuthContext>
}

export default AdminAuthProvider
