import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AdminAuthContext } from './adminAuthContext'
import { ADMIN_SIGNAL, checkAdminSession, endSession, startSession } from './session'

/*
 * Admin sign-in state for the whole dashboard.
 *   status: 'checking' | 'signedOut' | 'forbidden' (the server refused this session) | 'admin' | 'error'
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

  /** Signs in with an admin account. The server refuses customer accounts. */
  const signIn = useCallback(async (credentials) => {
    const user = await startSession(credentials)
    setSession({ status: 'admin', user })
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
