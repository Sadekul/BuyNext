import { ROUTES } from '../constants/routes'
import { getPurchaseLimits } from './inventory'

/*
 * Home page sections (docs/STOREFRONT_REDESIGN.md, "Home page"), picked from
 * data the storefront already loads: the categories and the product list.
 * Nothing here invents data: a section without real data gets an empty list
 * and the page leaves it out.
 */

/**
 * "Today's deals": products shoppers can buy right now with a real discount,
 * biggest first. `maxDiscount` is the largest whole percentage among them
 * (for "Up to 20% off"; rounded like the cards' badges, utils/pricing.js), or 0 when there are no deals.
 */
export function pickDeals(products = [], limit = 4) {
  const deals = products
    .filter((product) => Number(product.discountPercentage) >= 1 && getPurchaseLimits(product).canBuy)
    .toSorted((a, b) => b.discountPercentage - a.discountPercentage)
    .slice(0, limit)
  return { deals, maxDiscount: deals.length > 0 ? Math.round(deals[0].discountPercentage) : 0 }
}

/** The brand strip: brands with the most products first (ties A–Z), each linking to the catalog's brand filter. */
export function pickBrands(products = [], limit = 12) {
  const counts = new Map()
  for (const product of products) {
    const brand = typeof product.brand === 'string' ? product.brand.trim() : ''
    if (brand) counts.set(brand, (counts.get(brand) ?? 0) + 1)
  }
  return [...counts]
    .map(([name, count]) => ({ name, count, to: brandLink(name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** The catalog filtered to one brand (`/products?brand=Apple`, the same URL the brand filter writes). */
export const brandLink = (name) => `${ROUTES.products}?${new URLSearchParams({ brand: name })}`

/*
 * Phase 17 (docs/backend/PHASE17_CONTRACT.md §4): the marketplace-style home page.
 */

/** How far back the API counts sold units for "Best selling" (backend Product::BEST_SELLING_DAYS). */
export const BEST_SELLING_DAYS = 90

/**
 * The home page's product rankings, each sorted by the API: the "Top products"
 * tabs and the four compact lists. `labelKey` / `listKey` are marketing:
 * keys (tab label, compact list title); `viewAllTo` is the catalog with the
 * matching sort (constants/catalog.js SORT_OPTIONS; "best-selling" and
 * "newest" exist there with BuyNest's API only, like these rankings).
 * `requires`: the API capability the ranking needs (the demo has neither).
 * `salesOnly`: only products that really sold (rankedItems below).
 */
export const HOME_RANKINGS = [
  { id: 'best-selling', sortBy: 'bestSelling', salesOnly: true, labelKey: 'home.top.bestSelling', listKey: 'home.lists.bestSelling', viewAllTo: `${ROUTES.products}?sort=best-selling`, requires: 'bestSelling' },
  { id: 'trending', sortBy: 'rating', labelKey: 'home.top.trending', listKey: 'home.lists.topRated', viewAllTo: `${ROUTES.products}?sort=rating-desc` },
  { id: 'new', sortBy: 'createdAt', labelKey: 'home.top.newArrivals', listKey: 'home.lists.new', viewAllTo: `${ROUTES.products}?sort=newest`, requires: 'newest' },
  { id: 'on-sale', sortBy: 'discountPercentage', onSaleOnly: true, labelKey: 'home.top.onSale', listKey: 'home.lists.onSale', viewAllTo: `${ROUTES.products}?sort=discount-desc` },
]

/**
 * The products a ranking really has, from one API page (`{ items, hasSales }`):
 *   - best selling: only when the API says something sold (`meta.has_sales`), and only the
 *     products with units sold (`units_sold` > 0) — never the rating order the API falls
 *     back to for unsold products. Fields missing (an older API) count as no sales: [].
 *   - on sale: only discounts that round to at least 1% (sorting by discount lists the rest last).
 *   - otherwise the API's order unchanged.
 */
export function rankedItems(ranking, page) {
  const items = page?.items ?? []
  if (ranking.salesOnly) return page?.hasSales === true ? items.filter((product) => Number(product.unitsSold) > 0) : []
  if (ranking.onSaleOnly) return items.filter((product) => Math.round(Number(product.discountPercentage) || 0) >= 1)
  return items
}

/**
 * The rankings this catalog can really give: without sales data (the demo)
 * "Best selling" is left out rather than faked, without dates "New arrivals" too.
 */
export function availableRankings({ bestSelling = false, newest = false } = {}) {
  const can = { bestSelling, newest }
  return HOME_RANKINGS.filter((ranking) => !ranking.requires || can[ranking.requires])
}

/**
 * The compact lists' order (contract §4.5): Best selling, Top rated, On sale, New.
 */
const LIST_ORDER = ['best-selling', 'trending', 'on-sale', 'new']
export const compactListOrder = (rankings) => LIST_ORDER.map((id) => rankings.find((ranking) => ranking.id === id)).filter(Boolean)

/**
 * The hero row's side column takes the first `side` banners (desktop: beside
 * the hero); the promo row below gets the rest. Nothing is duplicated.
 */
export function splitBanners(banners = [], side = 2) {
  return { side: banners.slice(0, side), rest: banners.slice(side) }
}

/**
 * The category icon row: every top-level category (up to `limit`), the
 * configured ones first, each with a photo when one is known (its own image,
 * the configured one, or its first product's thumbnail) and `image: null`
 * otherwise (the row shows the category's icon instead). Unlike the earlier
 * photo tiles, a category without a photo is kept.
 */
export function pickCategoryIcons({ categories = [], products = [], configured = [], limit = 12 }) {
  const topLevel = (categories ?? []).filter((category) => !category.parentSlug && category.name)
  const configuredImage = new Map(configured.map((item) => [item.slug, item.image]))
  const order = new Map(configured.map((item, index) => [item.slug, index]))
  const firstThumbnail = new Map()
  for (const product of products) {
    if (product.category && product.thumbnail && !firstThumbnail.has(product.category)) firstThumbnail.set(product.category, product.thumbnail)
  }
  return topLevel
    .map((category, index) => ({
      slug: category.slug,
      name: category.name,
      image: category.image ?? configuredImage.get(category.slug) ?? firstThumbnail.get(category.slug) ?? null,
      rank: order.has(category.slug) ? order.get(category.slug) : configured.length + index,
    }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ slug, name, image }) => ({ slug, name, image }))
}
