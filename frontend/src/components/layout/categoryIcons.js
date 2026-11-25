import {
  LuBike,
  LuCar,
  LuCookingPot,
  LuDroplet,
  LuDumbbell,
  LuFlame,
  LuFootprints,
  LuGem,
  LuGlasses,
  LuHeadphones,
  LuHouse,
  LuLamp,
  LuLaptop,
  LuLayoutGrid,
  LuShirt,
  LuShoppingBag,
  LuShoppingBasket,
  LuSmartphone,
  LuSofa,
  LuSparkles,
  LuSprayCan,
  LuStore,
  LuTablet,
  LuTag,
  LuWatch,
} from 'react-icons/lu'
import { createElement } from 'react'
import { ROUTES } from '../../constants/routes'

/**
 * A small icon per category for the navigation (2026 redesign). Keyed by the
 * category slug (the demo store's slugs and DummyJSON's); a category the store
 * adds later gets the generic tag icon. Icons are decorative: the label names the link.
 */
const CATEGORY_ICONS = {
  beauty: LuSparkles,
  fragrances: LuSprayCan,
  furniture: LuSofa,
  groceries: LuShoppingBasket,
  'home-decoration': LuLamp,
  'kitchen-accessories': LuCookingPot,
  laptops: LuLaptop,
  'mens-shirts': LuShirt,
  'mens-shoes': LuFootprints,
  'mens-watches': LuWatch,
  'mobile-accessories': LuHeadphones,
  motorcycle: LuBike,
  'skin-care': LuDroplet,
  smartphones: LuSmartphone,
  'sports-accessories': LuDumbbell,
  sunglasses: LuGlasses,
  tablets: LuTablet,
  tops: LuShirt,
  vehicle: LuCar,
  'womens-bags': LuShoppingBag,
  'womens-dresses': LuShirt,
  'womens-jewellery': LuGem,
  'womens-shoes': LuFootprints,
  'womens-watches': LuWatch,
}

const CATEGORY_PREFIX = ROUTES.category('')

/** The icon for a category slug (generic tag icon when unknown). */
export function categoryIcon(slug) {
  return CATEGORY_ICONS[slug] ?? LuTag
}

/** The icon for a navigation link: Home, Shop all, Deals, "More", or a category page. */
export function navLinkIcon(link) {
  if (link.to === ROUTES.home) return LuHouse
  if (link.to === ROUTES.products) return LuStore
  if (link.to === ROUTES.deals) return LuFlame
  if (!link.to) return LuLayoutGrid
  if (link.to.startsWith(CATEGORY_PREFIX)) return categoryIcon(link.to.slice(CATEGORY_PREFIX.length))
  return LuTag
}

/** The link's icon as an element (decorative: hidden from screen readers). */
export function NavIcon({ link, className }) {
  return createElement(navLinkIcon(link), { 'aria-hidden': true, className })
}
