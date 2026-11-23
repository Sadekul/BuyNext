import { NavLink, Outlet, useNavigate } from 'react-router'
import { LuBell, LuCoins, LuHeart, LuLogOut, LuMapPin, LuPackage, LuShieldCheck, LuUndo2, LuUser } from 'react-icons/lu'
import { useAuth } from '../hooks/useAuth'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { ROUTES } from '../constants/routes'
import { REAL_SHOP } from '../constants/shop'
import { cn } from '../utils/classNames'
import './AccountLayout.css'
import { useTranslation } from 'react-i18next'

// The address book, returns, stock alerts, and privacy need BuyNest's API (REAL_SHOP); the demo has none.
const ACCOUNT_LINKS = [
  { labelKey: 'nav.profile', to: ROUTES.account, icon: LuUser, end: true },
  { labelKey: 'nav.orders', to: ROUTES.orders, icon: LuPackage },
  ...(REAL_SHOP
    ? [
        { labelKey: 'nav.addresses', to: ROUTES.addresses, icon: LuMapPin },
        { labelKey: 'nav.returns', to: ROUTES.returns, icon: LuUndo2 },
        { labelKey: 'nav.stockAlerts', to: ROUTES.stockAlerts, icon: LuBell },
      ]
    : []),
  { labelKey: 'nav.wishlist', to: ROUTES.wishlist, icon: LuHeart },
  ...(REAL_SHOP ? [{ labelKey: 'nav.privacy', to: ROUTES.privacy, icon: LuShieldCheck }] : []),
]
// Phase 11: only while the store has reward points on (its settings say so).
const REWARDS_LINK = { labelKey: 'nav.rewards', to: ROUTES.rewards, icon: LuCoins }

/** Shell for /account pages: greeting, account navigation, and sign-out. */
function AccountLayout() {
  const { t } = useTranslation('account')
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
        <p className="account__eyebrow">{t('layout.eyebrow')}</p>
        <h1>{t('layout.greeting', { name: user.firstName })}</h1>
      </header>

      <div className="account__layout">
        <nav className="account__nav" aria-label={t('nav.label')}>
          <ul className="account__nav-list">
            {links.map(({ labelKey, to, icon: Icon, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} className={({ isActive }) => cn('account__link', isActive && 'account__link--active')}>
                  <Icon aria-hidden="true" />
                  {t(labelKey)}
                </NavLink>
              </li>
            ))}
            <li>
              <button type="button" className="account__link account__logout" onClick={handleLogout}>
                <LuLogOut aria-hidden="true" />
                {t('nav.signOut')}
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
