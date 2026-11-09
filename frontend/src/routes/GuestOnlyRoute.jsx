import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { ROUTES } from '../constants/routes'

/** Sign-in and registration pages: signed-in customers go to their account instead. */
function GuestOnlyRoute() {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <Navigate to={ROUTES.account} replace /> : <Outlet />
}

export default GuestOnlyRoute
