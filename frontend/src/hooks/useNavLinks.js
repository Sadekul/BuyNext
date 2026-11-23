import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { categoriesQuery } from '../queries/productQueries'
import { HAS_CATEGORY_TREE } from '../services/categoryService'
import { MAIN_NAV_LINKS } from '../constants/site'
import { ROUTES } from '../constants/routes'
import { childCategories, topLevelCategories } from '../utils/categories'

// How many top-level categories fit in the desktop bar; the rest go under "More".
const INLINE_CATEGORIES = 5

const HOME = MAIN_NAV_LINKS.find((link) => link.to === ROUTES.home)
const SHOP_ALL = MAIN_NAV_LINKS.find((link) => link.to === ROUTES.products)
const DEALS = MAIN_NAV_LINKS.find((link) => link.to === ROUTES.deals)

/**
 * The main navigation. With BuyNest's API (phase 5 category tree) it lists
 * the store's top-level categories, each with its subcategories; the demo
 * (DummyJSON, a flat list) keeps the fixed links in constants/site.js.
 *
 * Returns `{ links, mobileLinks }`: the desktop bar shows the first few
 * categories and a "More" menu, the mobile drawer lists them all.
 * A link may have `children` (submenu links); "More" has no `to` of its own.
 */
export function useNavLinks() {
  const hasTree = HAS_CATEGORY_TREE
  // Shared with the catalog pages (same query key, cached for an hour).
  const { data: categories } = useQuery({ ...categoriesQuery(), enabled: hasTree })

  return useMemo(() => {
    if (!hasTree || !categories) return { links: MAIN_NAV_LINKS, mobileLinks: MAIN_NAV_LINKS }
    const toLink = (category) => ({
      label: category.name,
      to: ROUTES.category(category.slug),
      children: childCategories(categories, category.slug).map((child) => ({ label: child.name, to: ROUTES.category(child.slug) })),
    })
    const top = topLevelCategories(categories).map(toLink)
    const rest = top.slice(INLINE_CATEGORIES)
    const more = rest.length > 0 ? [{ label: 'More', labelKey: 'nav.more', id: 'more', children: rest }] : []
    return {
      links: [HOME, SHOP_ALL, ...top.slice(0, INLINE_CATEGORIES), ...more, DEALS],
      mobileLinks: [HOME, SHOP_ALL, ...top, DEALS],
    }
  }, [hasTree, categories])
}
