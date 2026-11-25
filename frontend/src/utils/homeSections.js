import { ROUTES } from '../constants/routes'
import { getPurchaseLimits } from './inventory'

/*
 * Home page sections (docs/STOREFRONT_REDESIGN.md, "Home page"), picked from
 * data the storefront already loads: the categories and the product list.
 * Nothing here invents data: a section without real data gets an empty list
 * and the page leaves it out.
 */

/**
 * "Shop by category" tiles: top-level categories, the configured ones first
 * (data/homeContent.js `featuredCategories`, in that order), then the rest in
 * the API's order. The photo is the category's own image (BuyNest's API),
 * else the configured one, else the thumbnail of the category's first
 * product. A category without any photo is skipped.
 */
export function pickCategoryTiles({ categories = [], products = [], configured = [], limit = 8 }) {
  const topLevel = categories.filter((category) => !category.parentSlug)
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
    .filter((category) => category.name && category.image)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ slug, name, image }) => ({ slug, name, image }))
}

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
