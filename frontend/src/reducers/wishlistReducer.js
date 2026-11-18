import { storedNumber, storedProductSnapshot, storedTimestamp } from '../utils/storedValues'

/*
 * Wishlist reducer: saved products, no duplicates, newest first.
 * Pure: the timestamp is created by the caller and passed in the action.
 */

export const WISHLIST_ACTIONS = {
  ADDED: 'wishlist/added',
  REMOVED: 'wishlist/removed',
  CLEARED: 'wishlist/cleared',
  PRODUCTS_REFRESHED: 'wishlist/productsRefreshed',
  REPLACED: 'wishlist/replaced',
}

export const EMPTY_WISHLIST = { items: [] }

const SNAPSHOT_FIELDS = [
  'title',
  'brand',
  'category',
  'thumbnail',
  'price',
  'discountPercentage',
  'rating',
  'stock',
  'minimumOrderQuantity',
  'availabilityStatus',
]

// Products with options (size, color) are bought on their page: the wishlist remembers that.
function toSnapshot(product) {
  return {
    ...Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [field, product[field] ?? null])),
    // Phase 10: a gift card's amount and recipient are chosen on its page too.
    ...((product.hasVariants === true || product.type === 'gift_card') && { hasVariants: true }),
  }
}

export function wishlistReducer(state, action) {
  switch (action.type) {
    case WISHLIST_ACTIONS.ADDED: {
      // Prevent duplicates: adding a saved product changes nothing.
      if (state.items.some((item) => item.productId === action.product.id)) return state
      const newItem = { productId: action.product.id, ...toSnapshot(action.product), addedAt: action.addedAt, isUnavailable: false }
      return { ...state, items: [newItem, ...state.items] }
    }

    case WISHLIST_ACTIONS.REMOVED:
      return { ...state, items: state.items.filter((item) => item.productId !== action.productId) }

    case WISHLIST_ACTIONS.CLEARED:
      return EMPTY_WISHLIST

    case WISHLIST_ACTIONS.PRODUCTS_REFRESHED: {
      const freshById = new Map(action.products.map((product) => [product.id, product]))
      return {
        ...state,
        items: state.items.map((item) => {
          const fresh = freshById.get(item.productId)
          if (!fresh) return { ...item, isUnavailable: true }
          const next = { ...item, ...toSnapshot(fresh), isUnavailable: false }
          if (fresh.hasVariants !== true) delete next.hasVariants // a new object: deleting from it is safe
          return next
        }),
      }
    }

    case WISHLIST_ACTIONS.REPLACED:
      return action.state

    default:
      return state
  }
}

/** Guest wishlist → account wishlist on sign-in: every product once, newest first. */
export function mergeWishlists(accountWishlist, guestWishlist) {
  const accountIds = new Set(accountWishlist.items.map((item) => item.productId))
  const items = [...guestWishlist.items.filter((item) => !accountIds.has(item.productId)), ...accountWishlist.items]
  return { items: items.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)) }
}

/** Validates stored data (rebuilding each line from checked fields) and removes duplicates. */
export function sanitizeWishlist(value) {
  if (!value || !Array.isArray(value.items)) return EMPTY_WISHLIST
  const seen = new Set()
  const items = []
  for (const stored of value.items) {
    if (!stored || !Number.isInteger(stored.productId) || seen.has(stored.productId)) continue
    const item = {
      productId: stored.productId,
      ...storedProductSnapshot(stored),
      rating: storedNumber(stored.rating, 0, 5),
      addedAt: storedTimestamp(stored.addedAt),
      ...(stored.hasVariants === true && { hasVariants: true }),
    }
    if (item.title === null || item.price === null) continue
    seen.add(item.productId)
    items.push(item)
  }
  return { items }
}
