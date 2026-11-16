import { useEffect, useId, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { LuChevronDown } from 'react-icons/lu'
import { cn } from '../../utils/classNames'
import './MainNavigation.css'

/**
 * Desktop category navigation. NavLink passes `isActive` to the className
 * function so the current page's link is highlighted automatically.
 *
 * Links with `children` (BuyNest's category tree) get a submenu: the
 * category name stays a normal link, and a separate button next to it opens
 * the list of subcategories (the "disclosure" pattern: a button with
 * aria-expanded, no hover-only menus). Escape, a click elsewhere, or moving
 * focus out closes it.
 */
function MainNavigation({ links }) {
  const [openMenu, setOpenMenu] = useState(null)
  const navRef = useRef(null)
  const { pathname } = useLocation()

  // A new page closes any open submenu (adjusting state during render, not in an effect).
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    setOpenMenu(null)
  }

  useEffect(() => {
    if (openMenu === null) return undefined
    function handlePointer(event) {
      if (!navRef.current?.contains(event.target)) setOpenMenu(null)
    }
    document.addEventListener('mousedown', handlePointer)
    return () => document.removeEventListener('mousedown', handlePointer)
  }, [openMenu])

  return (
    <nav className="main-nav" aria-label="Main" ref={navRef}>
      <ul className="main-nav__list container">
        {links.map((link) => {
          const id = link.id ?? link.to
          return link.children?.length > 0 ? (
            <SubmenuItem
              key={id}
              link={link}
              isOpen={openMenu === id}
              onToggle={() => setOpenMenu((current) => (current === id ? null : id))}
              onClose={() => setOpenMenu((current) => (current === id ? null : current))}
            />
          ) : (
            <li key={id}>
              <TopLink link={link} />
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function TopLink({ link }) {
  return (
    <NavLink
      to={link.to}
      end
      className={({ isActive }) =>
        cn('main-nav__link', isActive && 'main-nav__link--active', link.highlight && 'main-nav__link--highlight')
      }
    >
      {link.label}
    </NavLink>
  )
}

function SubmenuItem({ link, isOpen, onToggle, onClose }) {
  const menuId = useId()
  const buttonRef = useRef(null)

  function handleKeyDown(event) {
    if (event.key === 'Escape' && isOpen) {
      onClose()
      buttonRef.current?.focus()
    }
  }

  // Focus left the item (e.g. Tab past the last subcategory): close it.
  function handleBlur(event) {
    if (isOpen && !event.currentTarget.contains(event.relatedTarget)) onClose()
  }

  return (
    <li className="main-nav__item" onKeyDown={handleKeyDown} onBlur={handleBlur}>
      {link.to && <TopLink link={link} />}
      <button
        ref={buttonRef}
        type="button"
        className={cn('main-nav__toggle', !link.to && 'main-nav__link')}
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={onToggle}
      >
        {link.to ? <span className="visually-hidden">{`${link.label} subcategories`}</span> : link.label}
        <LuChevronDown aria-hidden="true" />
      </button>
      <ul id={menuId} className="main-nav__menu" hidden={!isOpen}>
        {link.children.map((child) => (
          <li key={child.to}>
            <NavLink to={child.to} end className={({ isActive }) => cn('main-nav__menu-link', isActive && 'main-nav__menu-link--active')}>
              {child.label}
            </NavLink>
            {child.children?.length > 0 && (
              <ul className="main-nav__submenu">
                {child.children.map((grandchild) => (
                  <li key={grandchild.to}>
                    <NavLink to={grandchild.to} end className={({ isActive }) => cn('main-nav__menu-link', isActive && 'main-nav__menu-link--active')}>
                      {grandchild.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </li>
  )
}

export default MainNavigation
