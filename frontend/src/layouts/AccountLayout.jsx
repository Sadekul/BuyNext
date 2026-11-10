import { NavLink, Outlet, useNavigate } from 'react-router'
import { LuHeart, LuLayoutDashboard, LuLogOut, LuPackage, LuUser } from 'react-icons/lu'
import { useAuth } from '../hooks/useAuth'
import { ROUTES } from '../constants/routes'
import { cn } from '../utils/classNames'
import './AccountLayout.css'

const ACCOUNT_LINKS = [
  { label: 'Profile', to: ROUTES.account, icon: LuUser, end: true },
  { label: 'Orders', to: ROUTES.orders, icon: LuPackage },
  { label: 'Wishlist', to: ROUTES.wishlist, icon: LuHeart },
]

/** Shell for /account pages: greeting, account navigation, and sign-out. */
function AccountLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate(ROUTES.home, { replace: true })
  }

  return (
    <div className="account section container">
      <header className="account__header">
        <p className="account__eyebrow">My account</p>
        <h1>Hi, {user.firstName}</h1>
      </header>

      <div className="account__layout">
        <nav className="account__nav" aria-label="Account">
          <ul className="account__nav-list">
            {ACCOUNT_LINKS.map(({ label, to, icon: Icon, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} className={({ isActive }) => cn('account__link', isActive && 'account__link--active')}>
                  <Icon aria-hidden="true" />
                  {label}
                </NavLink>
              </li>
            ))}
            {/* The dashboard is a separate app: a normal link. The admin service
                checks the role again on every request. */}
            {user.role === 'admin' && (
              <li>
                <a href="/admin/" className="account__link">
                  <LuLayoutDashboard aria-hidden="true" />
                  Shop admin
                </a>
              </li>
            )}
            <li>
              <button type="button" className="account__link account__logout" onClick={handleLogout}>
                <LuLogOut aria-hidden="true" />
                Sign out
              </button>
            </li>
          </ul>
        </nav>

        <div className="account__content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export default AccountLayout
