import { Navigate, NavLink, Outlet, useLocation } from 'react-router'
import { LuExternalLink, LuLogOut, LuShieldCheck } from 'react-icons/lu'
import { REAL_ACCOUNTS } from '../auth/accounts'
// Phase 9: two-step sign-in that the store requires before anything else.
import TwoFactorGate from '../components/TwoFactorGate'
import { useAdminAuth } from '../auth/useAdminAuth'
import { Loading } from '../components/States'
import AccessDenied from '../pages/AccessDenied'
import { fullName } from '../utils/format'
import { allowedNav } from '../utils/permissions'
import { LIVE_DATA } from '../api/mode'
import NotificationsBell from '../components/NotificationsBell'

function NavItem({ to, label, icon: Icon, end }) {
  return (
    <li>
      <NavLink to={to} end={end} className="admin__nav-link">
        <Icon aria-hidden="true" />
        {label}
      </NavLink>
    </li>
  )
}

/**
 * Dashboard shell, shown only to admins. Everyone else sees sign-in or
 * "access denied" (the API enforces the same rule on every request).
 */
function AdminLayout() {
  const { status, user, signOut, message, can } = useAdminAuth()
  const location = useLocation()

  if (status === 'checking') {
    return (
      <main>
        <Loading label="Checking your access…" />
      </main>
    )
  }
  if (status === 'signedOut') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (status === 'forbidden') return <AccessDenied />
  if (status === 'error') {
    return (
      <main className="state state--error" role="alert">
        <p>{message}</p>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    )
  }

  // Phase 9: the store requires two-step sign-in and this admin hasn't set it up yet.
  // Nothing else of the admin shows (the API refuses everything but enrolment too).
  if (user?.twoFactorSetupRequired === true) return <TwoFactorGate />

  return (
    <div className="admin">
      <a href="#admin-main" className="skip-link">
        Skip to main content
      </a>
      <aside className="admin__sidebar">
        <p className="admin__brand">
          Buy<span>Nest</span> <small>Admin</small>
        </p>
        <nav aria-label="Admin">
          <ul className="admin__nav">
            {allowedNav(can).map((entry) =>
              entry.heading ? (
                <li key={entry.heading} className="admin__nav-group">
                  <span id={`nav-${entry.heading}`} className="admin__nav-heading">
                    {entry.heading}
                  </span>
                  <ul className="admin__nav" aria-labelledby={`nav-${entry.heading}`}>
                    {entry.items.map((item) => (
                      <NavItem key={item.to} {...item} />
                    ))}
                  </ul>
                </li>
              ) : (
                <NavItem key={entry.to} {...entry} />
              ),
            )}
          </ul>
        </nav>
        <div className="admin__account">
          <p>
            Signed in as <strong>{user?.name || fullName(user) || user?.username}</strong>
            {typeof user?.role === 'object' && user.role?.name && <small className="admin__role"> · {user.role.name}</small>}
          </p>
          {/* The storefront is a different app: a normal link, not router navigation. */}
          {REAL_ACCOUNTS && (
            <NavLink to="/account/two-factor" className="admin__account-link">
              <LuShieldCheck aria-hidden="true" /> Two-step sign-in
            </NavLink>
          )}
          <a href="/" className="admin__account-link">
            <LuExternalLink aria-hidden="true" /> View store
          </a>
          <button type="button" className="admin__account-link" onClick={signOut}>
            <LuLogOut aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>
      <div className="admin__content">
        {/* Phase 7: the header with the notifications bell (BuyNest's backend only). */}
        {LIVE_DATA && (
          <header className="admin__topbar">
            <NotificationsBell />
          </header>
        )}
        <main id="admin-main" className="admin__main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default AdminLayout
