import { Navigate, NavLink, Outlet, useLocation } from 'react-router'
import { LuBoxes, LuExternalLink, LuFileText, LuLayoutDashboard, LuLogOut, LuReceipt, LuTicketPercent, LuUndo2, LuUsers } from 'react-icons/lu'
import { LIVE_DATA } from '../api/mode'
import { useAdminAuth } from '../auth/useAdminAuth'
import { Loading } from '../components/States'
import AccessDenied from '../pages/AccessDenied'
import { fullName } from '../utils/format'

const DEMO_NAV = [
  { to: '/', label: 'Overview', icon: LuLayoutDashboard, end: true },
  { to: '/products', label: 'Products', icon: LuBoxes },
  { to: '/orders', label: 'Orders', icon: LuReceipt },
  { to: '/customers', label: 'Customers', icon: LuUsers },
]

// Real data (phase 3) adds the sales documents and coupons, grouped like Magento's admin.
const LIVE_NAV = [
  { to: '/', label: 'Overview', icon: LuLayoutDashboard, end: true },
  { to: '/products', label: 'Products', icon: LuBoxes },
  {
    heading: 'Sales',
    items: [
      { to: '/orders', label: 'Orders', icon: LuReceipt },
      { to: '/invoices', label: 'Invoices', icon: LuFileText },
      { to: '/credit-memos', label: 'Credit memos', icon: LuUndo2 },
    ],
  },
  { heading: 'Marketing', items: [{ to: '/coupons', label: 'Coupons', icon: LuTicketPercent }] },
  { to: '/customers', label: 'Customers', icon: LuUsers },
]

const NAV = LIVE_DATA ? LIVE_NAV : DEMO_NAV

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
  const { status, user, signOut, message } = useAdminAuth()
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
            {NAV.map((entry) =>
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
          </p>
          {/* The storefront is a different app: a normal link, not router navigation. */}
          <a href="/" className="admin__account-link">
            <LuExternalLink aria-hidden="true" /> View store
          </a>
          <button type="button" className="admin__account-link" onClick={signOut}>
            <LuLogOut aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>
      <main id="admin-main" className="admin__main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}

export default AdminLayout
