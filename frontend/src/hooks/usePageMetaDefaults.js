import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { applyPageMeta } from '../utils/pageMeta'

/**
 * Used once, by the page shell (MainLayout): every page gets the site's
 * default description, canonical link, and Open Graph tags, even pages
 * without their own <PageMeta>. The canonical link follows the address, and
 * og:title follows the page's <title> when React changes it (a lazy page's
 * title appears after its code loads, the cart's title shows the item count).
 */
export function usePageMetaDefaults() {
  const { pathname } = useLocation()
  // Phase 13: a language switch rewrites the default description and title too.
  const { i18n } = useTranslation()

  useEffect(() => {
    applyPageMeta()
  }, [pathname, i18n.language])

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined
    let lastTitle = document.title
    const observer = new MutationObserver(() => {
      if (document.title === lastTitle) return
      lastTitle = document.title
      applyPageMeta()
    })
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [])
}
