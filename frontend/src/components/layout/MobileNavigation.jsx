import { NavLink } from 'react-router'
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
  const accountLinks = [
    isAuthenticated
      ? { label: 'My account', to: ROUTES.account, icon: LuUser }
      : { label: 'Sign in', to: ROUTES.login, icon: LuUser },
    { label: 'Wishlist', to: ROUTES.wishlist, icon: LuHeart },
    { label: 'Cart', to: ROUTES.cart, icon: LuShoppingBag },
  ]

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Menu" variant="drawer">
      <div className="mobile-nav">
        <SearchBar onSearch={onClose} />

        <nav aria-label="Mobile main">
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
                  {link.label}
                </NavLink>
                {link.children?.length > 0 && (
                  <ul className="mobile-nav__sublist" aria-label={`${link.label} subcategories`}>
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
      </div>
    </Modal>
  )
}

export default MobileNavigation
