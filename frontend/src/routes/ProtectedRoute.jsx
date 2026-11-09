import { Navigate, Outlet, useLocation } from 'react-router'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { ROUTES } from '../constants/routes'

/**
 * Layout route that only renders its children for signed-in customers.
 * Anonymous visitors are redirected to /login, remembering where they were
 * going (`state.from`) so login can send them back.
 *
 * This is a UX convenience, NOT security: the API must reject requests
 * without a valid token, because anyone can change frontend code.
 */
function ProtectedRoute() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'checking') {
    return (
      <div className="section container">
        <Loader label="Checking your session…" />
      </div>
    )
  }

  if (status === 'anonymous') {
    return <Navigate to={ROUTES.login} replace state={{ from: location }} />
  }

  return <Outlet />
}

export default ProtectedRoute
