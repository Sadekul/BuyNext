import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { LuHeart, LuMenu, LuShoppingBag, LuUser } from 'react-icons/lu'
import Logo from '../common/Logo'
import SearchBar from '../common/SearchBar'
import MainNavigation from './MainNavigation'
import MobileNavigation from './MobileNavigation'
import CurrencyPicker from './CurrencyPicker'
import LanguageSwitch from './LanguageSwitch'
import { ROUTES } from '../../constants/routes'
import { useCart } from '../../hooks/useCart'
import { useWishlist } from '../../hooks/useWishlist'
import { useAuth } from '../../hooks/useAuth'
import { formatNumber } from '../../utils/formatters'
import './Header.css'

/**
 * Site header: logo, search, account/wishlist/cart actions, and navigation.
 * Owns the `isMenuOpen` state because both the menu button (opens) and the
 * mobile drawer (closes) need it — the closest common parent holds the state.
 *
 * Cart and wishlist counts come from shared state (useCart, useWishlist).
 */
function Header({ navLinks, mobileNavLinks = navLinks }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const { totals, openCart } = useCart()
  const { count: wishlistCount } = useWishlist()
  const { user, isAuthenticated } = useAuth()
  const { t } = useTranslation('common')

  return (
    <header className="site-header">
      <div className="site-header__bar container">
        <button
          type="button"
          className="site-header__icon-button site-header__menu-button"
          onClick={() => setIsMenuOpen(true)}
          aria-label={t('header.openMenu')}
          aria-haspopup="dialog"
          aria-expanded={isMenuOpen}
        >
          <LuMenu aria-hidden="true" />
        </button>

        <Logo />

        <div className="site-header__search">
          <SearchBar />
        </div>

        {/* Phase 11: "show prices in" another currency, when the store offers one. */}
        <div className="site-header__currency">
          <CurrencyPicker />
        </div>

        {/* Phase 13: বাংলা / English. */}
        <LanguageSwitch className="site-header__language" />

        <nav className="site-header__actions" aria-label={t('header.actions')}>
          {/* The visible label is the start of the accessible name (WCAG 2.5.3). */}
          <Link to={isAuthenticated ? ROUTES.account : ROUTES.login} className="site-header__icon-button site-header__account">
            {isAuthenticated && user.image ? (
              <img className="site-header__avatar" src={user.image} alt="" width="28" height="28" />
            ) : (
              <LuUser aria-hidden="true" />
            )}
            <span className="site-header__action-label">{isAuthenticated ? t('header.greeting', { name: user.firstName }) : t('nav.signIn')}</span>
            {isAuthenticated && <span className="visually-hidden">{t('header.myAccountSuffix')}</span>}
          </Link>
          <HeaderCountLink to={ROUTES.wishlist} icon={LuHeart} label={t('nav.wishlist')} count={wishlistCount} />
          <button
            type="button"
            className="site-header__icon-button"
            onClick={openCart}
            aria-haspopup="dialog"
            aria-label={t('header.cartItems', { count: totals.totalQuantity })}
          >
            <LuShoppingBag aria-hidden="true" />
            <CountBadge count={totals.totalQuantity} />
          </button>
        </nav>
      </div>

      <div className="site-header__mobile-search container">
        <SearchBar />
      </div>

      <MainNavigation links={navLinks} />

      <MobileNavigation
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        links={mobileNavLinks}
      />
    </header>
  )
}

/** Icon link with a numeric badge. The accessible name includes the count. */
function HeaderCountLink({ to, icon: Icon, label, count }) {
  const { t } = useTranslation('common')
  return (
    <Link to={to} className="site-header__icon-button" aria-label={t('header.countItems', { label, count })}>
      <Icon aria-hidden="true" />
      <CountBadge count={count} />
    </Link>
  )
}

/** Small numeric badge; hidden from screen readers (the parent's label has the count). */
function CountBadge({ count }) {
  if (count <= 0) return null
  return (
    <span className="site-header__badge" aria-hidden="true">
      {count > 99 ? `${formatNumber(99)}+` : formatNumber(count)}
    </span>
  )
}

export default Header
