import { use } from 'react'
import { AdminAuthContext } from './adminAuthContext'

export function useAdminAuth() {
  const value = use(AdminAuthContext)
  if (!value) throw new Error('useAdminAuth must be used inside <AdminAuthProvider>.')
  return value
}
