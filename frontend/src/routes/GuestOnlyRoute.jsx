import { Navigate, Outlet } from 'react-router'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { ROUTES } from '../constants/routes'

/**
 * Sign-in and registration pages: signed-in customers go to their account
 * instead. While a stored session is being checked, wait: showing the form
 * and then jumping to /account would be confusing.
 */
function GuestOnlyRoute() {
  const { status } = useAuth()

  if (status === 'checking') {
    return (
      <div className="section container">
        <Loader label="Checking your session…" />
      </div>
    )
  }

  return status === 'authenticated' ? <Navigate to={ROUTES.account} replace /> : <Outlet />
}

export default GuestOnlyRoute
