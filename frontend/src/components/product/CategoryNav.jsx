import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router'
import { ROUTES } from '../../constants/routes'
import { cn } from '../../utils/classNames'
import './CategoryNav.css'

/**
 * Category links built from the categories API. Scrolls sideways on small
 * screens (keeping the active link in view) and wraps on large screens.
 */
function CategoryNav({ categories }) {
  const navRef = useRef(null)
  const { pathname } = useLocation()

  // After navigating, center the active link inside the scrollable row.
  // A ref gives us the real DOM node; we only adjust its scroll position.
  useEffect(() => {
    const nav = navRef.current
    const activeLink = nav?.querySelector('[aria-current="page"]')
    if (!activeLink) return
    nav.scrollLeft = activeLink.offsetLeft - nav.clientWidth / 2 + activeLink.offsetWidth / 2
  }, [pathname, categories])

  const linkClass = ({ isActive }) => cn('category-nav__link', isActive && 'category-nav__link--active')

  return (
    <nav ref={navRef} className="category-nav" aria-label="Product categories">
      <ul className="category-nav__list">
        <li>
          <NavLink to={ROUTES.products} end className={linkClass}>
            All products
          </NavLink>
        </li>
        {categories.map((category) => (
          <li key={category.slug}>
            <NavLink to={ROUTES.category(category.slug)} className={linkClass}>
              {category.name}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export default CategoryNav
