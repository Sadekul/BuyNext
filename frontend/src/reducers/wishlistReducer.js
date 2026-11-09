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

function toSnapshot(product) {
  return Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [field, product[field] ?? null]))
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
          return fresh ? { ...item, ...toSnapshot(fresh), isUnavailable: false } : { ...item, isUnavailable: true }
        }),
      }
    }

    case WISHLIST_ACTIONS.REPLACED:
      return action.state

    default:
      return state
  }
}

/** Validates stored data and removes duplicates. */
export function sanitizeWishlist(value) {
  if (!value || !Array.isArray(value.items)) return EMPTY_WISHLIST
  const seen = new Set()
  const items = value.items.filter((item) => {
    const isValid =
      item && Number.isInteger(item.productId) && typeof item.title === 'string' && typeof item.price === 'number'
    if (!isValid || seen.has(item.productId)) return false
    seen.add(item.productId)
    return true
  })
  return { items }
}
