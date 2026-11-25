import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import { LuHeart, LuHouse, LuLayoutGrid, LuSearch, LuShoppingBag } from 'react-icons/lu'
import { ROUTES } from '../../constants/routes'
import { useCart } from '../../hooks/useCart'
import { useWishlist } from '../../hooks/useWishlist'
import { formatNumber } from '../../utils/formatters'
import { cn } from '../../utils/classNames'
import './BottomTabBar.css'

// The phone search box in the header (Header gives it this id); the Search tab moves focus there.
export const MOBILE_SEARCH_INPUT_ID = 'mobile-search-input'

/**
 * Phase 17 bottom tab bar (phones only, under 768px): Home, Categories (opens
 * the category drawer), Search (focuses the search box), Wishlist and Cart
 * with counts. The current page's link has aria-current="page" (NavLink).
 * While it is on the page, `body.has-tab-bar` gives the body bottom padding
 * the bar's height (and lifts the compare bar, cookie banner and toasts), so it
 * never covers content. The layout leaves it out of the checkout.
 */
function BottomTabBar({ onOpenCategories }) {
  const { t } = useTranslation('common')
  const { totals } = useCart()
  const { count: wishlistCount } = useWishlist()

  useEffect(() => {
    document.body.classList.add('has-tab-bar')
    return () => document.body.classList.remove('has-tab-bar')
  }, [])

  function focusSearch() {
    const input = document.getElementById(MOBILE_SEARCH_INPUT_ID)
    if (!input) return
    input.scrollIntoView?.({ block: 'center' })
    input.focus()
  }

  return (
    <nav className="tab-bar" aria-label={t('tabBar.label')}>
      <ul className="tab-bar__list">
        <li>
          <NavLink to={ROUTES.home} end className={tabClass}>
            <LuHouse aria-hidden="true" className="tab-bar__icon" />
            <span className="tab-bar__label">{t('nav.home')}</span>
          </NavLink>
        </li>
        <li>
          <button type="button" className="tab-bar__item" onClick={onOpenCategories} aria-haspopup="dialog">
            <LuLayoutGrid aria-hidden="true" className="tab-bar__icon" />
            <span className="tab-bar__label">{t('tabBar.categories')}</span>
          </button>
        </li>
        <li>
          <button type="button" className="tab-bar__item" onClick={focusSearch}>
            <LuSearch aria-hidden="true" className="tab-bar__icon" />
            <span className="tab-bar__label">{t('tabBar.search')}</span>
          </button>
        </li>
        <li>
          <NavLink to={ROUTES.wishlist} className={tabClass} aria-label={t('header.countItems', { label: t('nav.wishlist'), count: wishlistCount })}>
            <LuHeart aria-hidden="true" className="tab-bar__icon" />
            <TabBadge count={wishlistCount} />
            <span className="tab-bar__label" aria-hidden="true">
              {t('nav.wishlist')}
            </span>
          </NavLink>
        </li>
        <li>
          <NavLink to={ROUTES.cart} className={tabClass} aria-label={t('header.countItems', { label: t('nav.cart'), count: totals.totalQuantity })}>
            <LuShoppingBag aria-hidden="true" className="tab-bar__icon" />
            <TabBadge count={totals.totalQuantity} />
            <span className="tab-bar__label" aria-hidden="true">
              {t('nav.cart')}
            </span>
          </NavLink>
        </li>
      </ul>
    </nav>
  )
}

const tabClass = ({ isActive }) => cn('tab-bar__item', isActive && 'tab-bar__item--active')

/** Count bubble; hidden from screen readers (the link's name has the count). */
function TabBadge({ count }) {
  if (count <= 0) return null
  return (
    <span className="tab-bar__badge" aria-hidden="true">
      {count > 99 ? `${formatNumber(99)}+` : formatNumber(count)}
    </span>
  )
}

export default BottomTabBar
