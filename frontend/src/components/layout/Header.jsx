import { useState } from 'react'
import { Link } from 'react-router'
import { LuHeart, LuMenu, LuShoppingBag, LuUser } from 'react-icons/lu'
import Logo from '../common/Logo'
import SearchBar from '../common/SearchBar'
import MainNavigation from './MainNavigation'
import MobileNavigation from './MobileNavigation'
import { ROUTES } from '../../constants/routes'
import './Header.css'

/**
 * Site header: logo, search, account/wishlist/cart actions, and navigation.
 * Owns the `isMenuOpen` state because both the menu button (opens) and the
 * mobile drawer (closes) need it — the closest common parent holds the state.
 *
 * cartCount / wishlistCount are props for now; Phases 6–7 feed them from
 * shared cart and wishlist state.
 */
function Header({ navLinks, cartCount = 0, wishlistCount = 0 }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

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
          <Link to={ROUTES.account} className="site-header__icon-button site-header__account">
            <LuUser aria-hidden="true" />
            <span className="site-header__action-label">Account</span>
          </Link>
          <HeaderCountLink to={ROUTES.wishlist} icon={LuHeart} label="Wishlist" count={wishlistCount} />
          <HeaderCountLink to={ROUTES.cart} icon={LuShoppingBag} label="Cart" count={cartCount} />
        </nav>
      </div>

      <div className="site-header__mobile-search container">
        <SearchBar />
      </div>

      <MainNavigation links={navLinks} />

      <MobileNavigation
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        links={navLinks}
      />
    </header>
  )
}

/** Icon link with a numeric badge. The accessible name includes the count. */
function HeaderCountLink({ to, icon: Icon, label, count }) {
  return (
    <Link to={to} className="site-header__icon-button" aria-label={`${label}, ${count} items`}>
      <Icon aria-hidden="true" />
      {count > 0 && (
        <span className="site-header__badge" aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}

export default Header
