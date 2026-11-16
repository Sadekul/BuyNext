import { useState } from 'react'
import { Link } from 'react-router'
import { LuHeart, LuMenu, LuShoppingBag, LuUser } from 'react-icons/lu'
import Logo from '../common/Logo'
import SearchBar from '../common/SearchBar'
import MainNavigation from './MainNavigation'
import MobileNavigation from './MobileNavigation'
import { ROUTES } from '../../constants/routes'
import { useCart } from '../../hooks/useCart'
import { useWishlist } from '../../hooks/useWishlist'
import { useAuth } from '../../hooks/useAuth'
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

  return (
    <header className="site-header">
      <div className="site-header__bar container">
        <button
          type="button"
          className="site-header__icon-button site-header__menu-button"
          onClick={() => setIsMenuOpen(true)}
          aria-label="Open menu"
          aria-haspopup="dialog"
          aria-expanded={isMenuOpen}
        >
          <LuMenu aria-hidden="true" />
        </button>

        <Logo />

        <div className="site-header__search">
          <SearchBar />
        </div>

        <nav className="site-header__actions" aria-label="Account and shopping">
          {/* The visible label is the start of the accessible name (WCAG 2.5.3). */}
          <Link to={isAuthenticated ? ROUTES.account : ROUTES.login} className="site-header__icon-button site-header__account">
            {isAuthenticated && user.image ? (
              <img className="site-header__avatar" src={user.image} alt="" width="28" height="28" />
            ) : (
              <LuUser aria-hidden="true" />
            )}
            <span className="site-header__action-label">{isAuthenticated ? `Hi, ${user.firstName}` : 'Sign in'}</span>
            {isAuthenticated && <span className="visually-hidden">, my account</span>}
          </Link>
          <HeaderCountLink to={ROUTES.wishlist} icon={LuHeart} label="Wishlist" count={wishlistCount} />
          <button
            type="button"
            className="site-header__icon-button"
            onClick={openCart}
            aria-haspopup="dialog"
            aria-label={`Cart, ${totals.totalQuantity} items`}
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
  return (
    <Link to={to} className="site-header__icon-button" aria-label={`${label}, ${count} items`}>
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
      {count > 99 ? '99+' : count}
    </span>
  )
}

export default Header
