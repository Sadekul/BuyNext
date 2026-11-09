import { useContext } from 'react'
import { AuthContext } from '../context/authContext'

/** Access the signed-in customer and auth actions. Throws outside <AuthProvider>. */
export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth() must be used inside <AuthProvider>.')
  return auth
}
