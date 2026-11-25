import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { LuHeart, LuMenu, LuShoppingBag, LuUser } from 'react-icons/lu'
import Logo from '../common/Logo'
import SearchBar from '../common/SearchBar'
import MainNavigation from './MainNavigation'
import MobileNavigation from './MobileNavigation'
import MegaMenu from './MegaMenu'
import TopBar from './TopBar'
import { DeliverToButton, DeliverToDialog } from './DeliverTo'
import { MOBILE_SEARCH_INPUT_ID } from './BottomTabBar'
import { ROUTES } from '../../constants/routes'
import { useCart } from '../../hooks/useCart'
import { useWishlist } from '../../hooks/useWishlist'
import { useAuth } from '../../hooks/useAuth'
import { useCategories } from '../../hooks/useCategories'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { useStickyHeader } from '../../hooks/useStickyHeader'
import { topLevelCategories } from '../../utils/categories'
import { formatNumber } from '../../utils/formatters'
import { cn } from '../../utils/classNames'
import './Header.css'

/**
 * Site header (phase 17 marketplace layout), top to bottom:
 * 1. TopBar: delivery line, the admin's promo and coupon, language and currency
 *    (`compactTopBar` in the checkout: language and currency only). It scrolls away.
 * 2. The bar: menu button (below 1024px), logo, wide search with a "Search in"
 *    category select, "Deliver to" (Bangladesh stores), account, wishlist, cart.
 * 3. Phones: the search box and the "Deliver to" line under the bar.
 * 4. Desktop: "All categories" (mega menu) and the main category links.
 * Sticky; turns compact further down without moving the page (useStickyHeader).
 *
 * The menu drawer's open state can be owned by the layout (`menuOpen` and
 * `onMenuOpenChange`, so the phone tab bar can open it too); otherwise here.
 * Cart and wishlist counts come from shared state (useCart, useWishlist).
 */
function Header({ navLinks, mobileNavLinks = navLinks, menuOpen, onMenuOpenChange, compactTopBar = false }) {
  const [ownMenuOpen, setOwnMenuOpen] = useState(false)
  const isMenuOpen = menuOpen ?? ownMenuOpen
  const setIsMenuOpen = onMenuOpenChange ?? setOwnMenuOpen
  const [isDeliverToOpen, setIsDeliverToOpen] = useState(false)
  const { totals, openCart } = useCart()
  const { count: wishlistCount } = useWishlist()
  const { user, isAuthenticated } = useAuth()
  const { settings } = useStoreSettings()
  const { data: categories } = useCategories()
  const { headerRef, topBarRef, compact } = useStickyHeader()
  const { t } = useTranslation('common')

  // Phase 17: "Deliver to" only where the API knows the places (a Bangladeshi store).
  const showDeliverTo = settings.bangladeshAddresses === true
  const searchCategories = topLevelCategories(categories ?? []).map(({ slug, name }) => ({ slug, name }))
  const openDeliverTo = () => setIsDeliverToOpen(true)

  return (
    <header className={cn('site-header', compact && 'site-header--compact')} ref={headerRef}>
      <div ref={topBarRef}>
        <TopBar compact={compactTopBar} />
      </div>

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
          <SearchBar categories={searchCategories} />
        </div>

        {showDeliverTo && <DeliverToButton className="site-header__deliver" onClick={openDeliverTo} isOpen={isDeliverToOpen} />}

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
        <SearchBar inputId={MOBILE_SEARCH_INPUT_ID} />
        {showDeliverTo && <DeliverToButton className="deliver-to--row" onClick={openDeliverTo} isOpen={isDeliverToOpen} />}
      </div>

      <div className="site-header__nav-row">
        <div className="site-header__nav-inner container">
          <MegaMenu />
          <MainNavigation links={navLinks} />
        </div>
      </div>

      <MobileNavigation isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} links={mobileNavLinks} />
      {showDeliverTo && <DeliverToDialog isOpen={isDeliverToOpen} onClose={() => setIsDeliverToOpen(false)} />}
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
