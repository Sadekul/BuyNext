import { NavLink } from 'react-router'
import { cn } from '../../utils/classNames'
import './MainNavigation.css'

/**
 * Desktop category navigation. NavLink passes `isActive` to the className
 * function so the current page's link is highlighted automatically.
 */
function MainNavigation({ links }) {
  return (
    <nav className="main-nav" aria-label="Main">
      <ul className="main-nav__list container">
        {links.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              end
              className={({ isActive }) =>
                cn('main-nav__link', isActive && 'main-nav__link--active', link.highlight && 'main-nav__link--highlight')
              }
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export default MainNavigation
