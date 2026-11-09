import { formatPrice } from '../utils/formatters'
import { clampQuantity, getPurchaseLimits } from '../utils/inventory'

/*
 * Cart reducer: a pure function (state, action) → new state.
 * It never mutates `state`; every case returns new objects/arrays.
 * All quantity rules (minimum order, stock) are enforced here, in one place.
 */

export const CART_ACTIONS = {
  ADDED: 'cart/added',
  QUANTITY_CHANGED: 'cart/quantityChanged',
  REMOVED: 'cart/removed',
  CLEARED: 'cart/cleared',
  COUPON_APPLIED: 'cart/couponApplied',
  COUPON_REMOVED: 'cart/couponRemoved',
  PRODUCTS_REFRESHED: 'cart/productsRefreshed',
  REPLACED: 'cart/replaced',
}

export const EMPTY_CART = { items: [], couponCode: null }

// Product fields copied into the cart (a snapshot; refreshed on the cart page).
const SNAPSHOT_FIELDS = [
  'title',
  'brand',
  'category',
  'thumbnail',
  'price',
  'discountPercentage',
  'stock',
  'minimumOrderQuantity',
  'availabilityStatus',
]

function toSnapshot(product) {
  return Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [field, product[field] ?? null]))
}

export function cartReducer(state, action) {
  switch (action.type) {
    case CART_ACTIONS.ADDED: {
      const { product, quantity } = action
      const limits = getPurchaseLimits(product)
      if (!limits.canBuy) return state

      const existing = state.items.find((item) => item.productId === product.id)
      if (existing) {
        return {
          ...state,
          items: state.items.map((item) =>
            item.productId === product.id
              ? { ...item, ...toSnapshot(product), quantity: clampQuantity(item.quantity + quantity, limits), notice: null, isUnavailable: false }
              : item,
          ),
        }
      }

      const newItem = {
        productId: product.id,
        ...toSnapshot(product),
        quantity: clampQuantity(quantity, limits),
        notice: null,
        isUnavailable: false,
      }
      return { ...state, items: [...state.items, newItem] }
    }

    case CART_ACTIONS.QUANTITY_CHANGED:
      return {
        ...state,
        items: state.items.map((item) =>
          item.productId === action.productId
            ? { ...item, quantity: clampQuantity(action.quantity, getPurchaseLimits(item)), notice: null }
            : item,
        ),
      }

    case CART_ACTIONS.REMOVED:
      return { ...state, items: state.items.filter((item) => item.productId !== action.productId) }

    case CART_ACTIONS.CLEARED:
      return EMPTY_CART

    case CART_ACTIONS.COUPON_APPLIED:
      return { ...state, couponCode: action.code.trim().toUpperCase() }

    case CART_ACTIONS.COUPON_REMOVED:
      return { ...state, couponCode: null }

    // Fresh product data arrived from the API: update snapshots, clamp
    // quantities to current stock, and explain any change to the shopper.
    case CART_ACTIONS.PRODUCTS_REFRESHED: {
      const freshById = new Map(action.products.map((product) => [product.id, product]))
      return {
        ...state,
        items: state.items.map((item) => {
          const fresh = freshById.get(item.productId)
          if (!fresh) return { ...item, isUnavailable: true, notice: 'This product is no longer available.' }

          const limits = getPurchaseLimits(fresh)
          if (!limits.canBuy) {
            return { ...item, ...toSnapshot(fresh), isUnavailable: true, notice: 'This product is out of stock.' }
          }

          const quantity = clampQuantity(item.quantity, limits)
          let notice = item.notice
          if (quantity < item.quantity) notice = `Quantity reduced to ${quantity}: only ${fresh.stock} in stock.`
          else if (fresh.price !== item.price || fresh.discountPercentage !== item.discountPercentage) {
            notice = `Price updated (was ${formatPrice(item.price)} before discount).`
          }
          return { ...item, ...toSnapshot(fresh), quantity, isUnavailable: false, notice }
        }),
      }
    }

    // Another browser tab changed the cart.
    case CART_ACTIONS.REPLACED:
      return action.state

    default:
      return state
  }
}

/** Validates data loaded from storage; anything malformed is dropped. */
export function sanitizeCart(value) {
  if (!value || !Array.isArray(value.items)) return EMPTY_CART
  const items = value.items.filter(
    (item) =>
      item &&
      Number.isInteger(item.productId) &&
      Number.isInteger(item.quantity) &&
      item.quantity > 0 &&
      typeof item.price === 'number' &&
      typeof item.title === 'string',
  )
  return { items, couponCode: typeof value.couponCode === 'string' ? value.couponCode : null }
}
