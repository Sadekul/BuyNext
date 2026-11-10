import { Link } from 'react-router'
import { LuLock } from 'react-icons/lu'
import { useAdminAuth } from '../auth/useAdminAuth'
import { firstAllowedPath, permissionLabel } from '../utils/permissions'

/**
 * "You don't have access": the admin's role lacks a permission. Shown when a
 * screen needs one the role doesn't have, and for the API's 403
 * `permission_denied` answers (which name the permission).
 */
export function NoPermission({ permission }) {
  const { user, can } = useAdminAuth()
  const home = firstAllowedPath(can)
  const roleName = typeof user?.role === 'object' ? user.role?.name : null
  return (
    <section className="no-access" role="alert" aria-labelledby="no-access-title">
      <LuLock className="no-access__icon" aria-hidden="true" />
      <h1 id="no-access-title">You don't have access</h1>
      <p>
        {roleName ? (
          <>
            Your role, <strong>{roleName}</strong>, doesn't include
          </>
        ) : (
          "Your role doesn't include"
        )}{' '}
        {permission ? (
          <>
            the permission <strong>{permissionLabel(permission)}</strong> <code>({permission})</code>.
          </>
        ) : (
          'this.'
        )}
      </p>
      <p className="muted">Ask an admin who manages admin users and roles if you need it.</p>
      {home && (
        <Link to={home} className="btn btn--outline btn--sm">
          Go to a page you can open
        </Link>
      )}
    </section>
  )
}

/** Renders `children` only if the role has `permission`; otherwise "You don't have access". */
export function RequirePermission({ permission, children }) {
  const { can } = useAdminAuth()
  return can(permission) ? children : <NoPermission permission={permission} />
}
