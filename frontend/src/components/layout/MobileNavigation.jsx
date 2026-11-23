import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import LanguageSwitch from './LanguageSwitch'
import { linkLabel } from './navLabel'
import { LuHeart, LuShoppingBag, LuUser } from 'react-icons/lu'
import Modal from '../ui/Modal'
import SearchBar from '../common/SearchBar'
import { ROUTES } from '../../constants/routes'
import { cn } from '../../utils/classNames'
import { useAuth } from '../../hooks/useAuth'
import './MobileNavigation.css'

/**
 * Mobile/tablet menu. Composition in action: it reuses Modal (drawer variant)
 * for focus trapping and Escape handling, and SearchBar for search.
 * Every link calls `onClose` so the drawer closes after navigating.
 * Categories with subcategories (BuyNest's category tree) list them indented below.
 */
function MobileNavigation({ isOpen, onClose, links }) {
  const { isAuthenticated } = useAuth()
  const { t } = useTranslation('common')
  const accountLinks = [
    isAuthenticated
      ? { label: t('nav.myAccount'), to: ROUTES.account, icon: LuUser }
      : { label: t('nav.signIn'), to: ROUTES.login, icon: LuUser },
    { label: t('nav.wishlist'), to: ROUTES.wishlist, icon: LuHeart },
    { label: t('nav.cart'), to: ROUTES.cart, icon: LuShoppingBag },
  ]

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('nav.menu')} variant="drawer">
      <div className="mobile-nav">
        <SearchBar onSearch={onClose} />

        <nav aria-label={t('nav.mobileMain')}>
          <ul className="mobile-nav__list">
            {links.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn('mobile-nav__link', isActive && 'mobile-nav__link--active', link.highlight && 'mobile-nav__link--highlight')
                  }
                >
                  {linkLabel(t, link)}
                </NavLink>
                {link.children?.length > 0 && (
                  <ul className="mobile-nav__sublist" aria-label={t('nav.subcategories', { label: linkLabel(t, link) })}>
                    {link.children.map((child) => (
                      <li key={child.to}>
                        <NavLink
                          to={child.to}
                          end
                          onClick={onClose}
                          className={({ isActive }) => cn('mobile-nav__link mobile-nav__link--child', isActive && 'mobile-nav__link--active')}
                        >
                          {child.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <ul className="mobile-nav__list mobile-nav__list--secondary">
          {accountLinks.map(({ label, to, icon: Icon }) => (
            <li key={to}>
              <NavLink to={to} onClick={onClose} className="mobile-nav__link">
                <Icon aria-hidden="true" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>

        {/* Phase 13: বাংলা / English. */}
        <LanguageSwitch className="mobile-nav__language" />
      </div>
    </Modal>
  )
}

export default MobileNavigation
