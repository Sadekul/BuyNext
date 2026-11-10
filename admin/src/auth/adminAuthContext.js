import { createContext } from 'react'

/** Admin sign-in state; provided by <AdminAuthProvider>, read with useAdminAuth(). */
export const AdminAuthContext = createContext(null)
