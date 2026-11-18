import { pick } from '../http.js'

/*
 * Phase 11: the API's storefront product card (wishlist items, shared
 * wishlists, cart cross-sells), allow-listed for the browser. It keeps the
 * catalog's snake_case shape on purpose: the storefront turns it into a
 * BuyNest product with the catalog's own adapter (src/services/adapters/laravelAdapter.js).
 */

const CARD_KEYS = [
  'id', 'name', 'slug', 'sku', 'price', 'discount_percent', 'sale_price', 'rating_average', 'review_count', 'stock_quantity', 'availability',
  'min_order_quantity', 'has_variants', 'thumbnail_url', 'tags', 'weight', 'type',
]
// Image addresses the page may show: the store's own /media/… files, or https.
const imageUrl = (value) => (typeof value === 'string' && /^(https:\/\/\S+|\/media\/\S+)$/.test(value) ? value : null)

/** The API's product card, allow-listed (nested objects too): never more than the catalog itself shows. */
export function productCard(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.id)) return null
  const card = pick(raw, CARD_KEYS)
  card.thumbnail_url = imageUrl(raw.thumbnail_url)
  if (raw.thumbnail_variants && typeof raw.thumbnail_variants === 'object') {
    card.thumbnail_variants = Object.fromEntries(Object.entries(raw.thumbnail_variants).filter(([width, url]) => /^\d{2,4}$/.test(width) && imageUrl(url)))
  }
  if (raw.brand && typeof raw.brand === 'object') card.brand = pick(raw.brand, ['id', 'name', 'slug'])
  if (raw.category && typeof raw.category === 'object') card.category = pick(raw.category, ['id', 'name', 'slug'])
  if (raw.price_rule && typeof raw.price_rule === 'object') card.price_rule = pick(raw.price_rule, ['id', 'name'])
  if (raw.gift_card && typeof raw.gift_card === 'object') card.gift_card = pick(raw.gift_card, ['amounts', 'custom'])
  return card
}

export const productCards = (raw, max) => (Array.isArray(raw) ? raw.slice(0, max).map(productCard).filter(Boolean) : [])

