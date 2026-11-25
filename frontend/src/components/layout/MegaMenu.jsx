import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import { LuChevronDown, LuLayoutGrid } from 'react-icons/lu'
import { categoryIcon } from './categoryIcons'
import { REAL_SHOP } from '../../constants/shop'
import { ROUTES } from '../../constants/routes'
import { useCategories } from '../../hooks/useCategories'
import { homeContentQuery } from '../../queries/contentQueries'
import { localizedPromoBanners } from '../../data/homeContent'
import { childCategories, topLevelCategories } from '../../utils/categories'
import './MegaMenu.css'

// Subcategories listed under each category; the category link leads to the rest.
const CHILDREN_SHOWN = 6

/** The featured promo: the first active home banner (the admin's with BuyNest's API, the demo's otherwise). */
function useFeaturedBanner(enabled) {
  const { t } = useTranslation('marketing')
  const home = useQuery({ ...homeContentQuery(), enabled: REAL_SHOP && enabled })
  if (!REAL_SHOP) return localizedPromoBanners(t)[0] ?? null
  return home.data?.banners?.[0] ?? null
}

/**
 * Phase 17 "All categories" mega menu (desktop header). A disclosure button
 * (aria-expanded) opens a panel with the category tree in columns (an icon
 * per top-level category, its first subcategories) and a featured promo from
 * the first active banner. Keyboard: ↓ on the button opens it and moves to
 * the first link, ↑/↓/Home/End move between the links, Escape closes it and
 * returns to the button; a click outside, moving focus out, or a new page
 * closes it too. Not a role="menu": the links are ordinary links.
 */
function MegaMenu() {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const panelRef = useRef(null)
  const panelId = useId()
  const { pathname } = useLocation()
  const categoriesRequest = useCategories()
  const banner = useFeaturedBanner(open)

  // A new page closes it (adjusting state during render, not in an effect).
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return undefined
    function handlePointer(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    return () => document.removeEventListener('mousedown', handlePointer)
  }, [open])

  const links = () => [...(panelRef.current?.querySelectorAll('a') ?? [])]

  function focusLink(index) {
    const all = links()
    if (all.length === 0) return
    all[(index + all.length) % all.length].focus()
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
      return
    }
    const onButton = event.target === buttonRef.current
    if (onButton && event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      // The panel renders on this click; move in once it's there.
      requestAnimationFrame(() => focusLink(0))
      return
    }
    if (!open || onButton) return
    const all = links()
    const index = all.indexOf(document.activeElement)
    if (index === -1) return
    const moves = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: all.length - 1 }
    if (event.key in moves) {
      event.preventDefault()
      focusLink(moves[event.key])
    }
  }

  // Focus left the menu (Tab past the last link): close it.
  function handleBlur(event) {
    if (open && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }

  const categories = categoriesRequest.data ?? []
  const top = topLevelCategories(categories)
  const close = () => setOpen(false)

  return (
    <nav className="mega-menu" aria-label={t('megaMenu.button')} ref={rootRef} onKeyDown={handleKeyDown} onBlur={handleBlur}>
      <button
        ref={buttonRef}
        type="button"
        className="mega-menu__button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <LuLayoutGrid aria-hidden="true" className="mega-menu__button-icon" />
        {t('megaMenu.button')}
        <LuChevronDown aria-hidden="true" className="mega-menu__chevron" />
      </button>

      <div id={panelId} ref={panelRef} className="mega-menu__panel" hidden={!open}>
        <div className="mega-menu__body">
          {categoriesRequest.isPending ? (
            <p className="mega-menu__note">{t('megaMenu.loading')}</p>
          ) : categoriesRequest.isError ? (
            <p className="mega-menu__note">{t('megaMenu.failed')}</p>
          ) : (
            <ul className="mega-menu__columns">
              {top.map((category) => {
                const Icon = categoryIcon(category.slug)
                const children = childCategories(categories, category.slug)
                return (
                  <li key={category.slug} className="mega-menu__group">
                    <Link to={ROUTES.category(category.slug)} className="mega-menu__category" onClick={close}>
                      <span className="mega-menu__icon" aria-hidden="true">
                        <Icon />
                      </span>
                      {category.name}
                    </Link>
                    {children.length > 0 && (
                      <ul className="mega-menu__children">
                        {children.slice(0, CHILDREN_SHOWN).map((child) => (
                          <li key={child.slug}>
                            <Link to={ROUTES.category(child.slug)} className="mega-menu__child" onClick={close}>
                              {child.name}
                            </Link>
                          </li>
                        ))}
                        {children.length > CHILDREN_SHOWN && (
                          <li>
                            <Link to={ROUTES.category(category.slug)} className="mega-menu__child mega-menu__child--more" onClick={close}>
                              {t('megaMenu.shopAll', { name: category.name })}
                            </Link>
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <Link to={ROUTES.products} className="mega-menu__all" onClick={close}>
            {t('megaMenu.allProducts')}
          </Link>
        </div>
        {banner && <FeaturedPromo banner={banner} onNavigate={close} />}
      </div>
    </nav>
  )
}

/** The first active banner, compact: eyebrow, title, image and its link (no link: no promo). */
function FeaturedPromo({ banner, onNavigate }) {
  const { t } = useTranslation('common')
  if (!banner.cta?.to) return null
  const external = /^https?:\/\//i.test(banner.cta.to)
  const content = (
    <>
      <span className="mega-menu__promo-kicker">{banner.eyebrow || t('megaMenu.featured')}</span>
      <span className="mega-menu__promo-title">{banner.title}</span>
      {banner.image && <img className="mega-menu__promo-image" src={banner.image} alt="" loading="lazy" width="160" height="120" />}
      <span className="mega-menu__promo-cta">{banner.cta.label}</span>
    </>
  )
  return external ? (
    <a href={banner.cta.to} className="mega-menu__promo" onClick={onNavigate}>
      {content}
    </a>
  ) : (
    <Link to={banner.cta.to} className="mega-menu__promo" onClick={onNavigate}>
      {content}
    </Link>
  )
}

export default MegaMenu
