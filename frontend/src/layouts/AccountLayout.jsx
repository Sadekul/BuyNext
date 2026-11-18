import { NavLink, Outlet, useNavigate } from 'react-router'
import { LuBell, LuCoins, LuHeart, LuLogOut, LuMapPin, LuPackage, LuShieldCheck, LuUndo2, LuUser } from 'react-icons/lu'
import { useAuth } from '../hooks/useAuth'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { ROUTES } from '../constants/routes'
import { REAL_SHOP } from '../constants/shop'
import { cn } from '../utils/classNames'
import './AccountLayout.css'

// The address book, returns, stock alerts, and privacy need BuyNest's API (REAL_SHOP); the demo has none.
const ACCOUNT_LINKS = [
  { label: 'Profile', to: ROUTES.account, icon: LuUser, end: true },
  { label: 'Orders', to: ROUTES.orders, icon: LuPackage },
  ...(REAL_SHOP
    ? [
        { label: 'Address book', to: ROUTES.addresses, icon: LuMapPin },
        { label: 'Returns', to: ROUTES.returns, icon: LuUndo2 },
        { label: 'Stock alerts', to: ROUTES.stockAlerts, icon: LuBell },
      ]
    : []),
  { label: 'Wishlist', to: ROUTES.wishlist, icon: LuHeart },
  ...(REAL_SHOP ? [{ label: 'Privacy', to: ROUTES.privacy, icon: LuShieldCheck }] : []),
]
// Phase 11: only while the store has reward points on (its settings say so).
const REWARDS_LINK = { label: 'Reward points', to: ROUTES.rewards, icon: LuCoins }

/** Shell for /account pages: greeting, account navigation, and sign-out. */
function AccountLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { settings } = useStoreSettings()
  const links = REAL_SHOP && settings.rewards ? [...ACCOUNT_LINKS.slice(0, 2), REWARDS_LINK, ...ACCOUNT_LINKS.slice(2)] : ACCOUNT_LINKS

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
            {links.map(({ label, to, icon: Icon, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} className={({ isActive }) => cn('account__link', isActive && 'account__link--active')}>
                  <Icon aria-hidden="true" />
                  {label}
                </NavLink>
              </li>
            ))}
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
