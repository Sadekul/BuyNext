import { formatPrice } from '../utils/formatters'
import { clampQuantity, getPurchaseLimits } from '../utils/inventory'
import { getProductPricing } from '../utils/pricing'

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

/** Explains why the stored quantity differs from what was requested, or null. */
function quantityNotice(requested, actual, limits) {
  if (actual < requested) return `Only ${limits.max} available, so the quantity was set to ${actual}.`
  if (actual > requested) return `Minimum order is ${limits.min}, so the quantity was set to ${actual}.`
  return null
}

export function cartReducer(state, action) {
  switch (action.type) {
    case CART_ACTIONS.ADDED: {
      const { product, quantity } = action
      const limits = getPurchaseLimits(product)
      if (!limits.canBuy) return state

      // Tell the shopper when the requested amount had to be capped by stock.
      const existing = state.items.find((item) => item.productId === product.id)
      if (existing) {
        const requested = existing.quantity + quantity
        const nextQuantity = clampQuantity(requested, limits)
        return {
          ...state,
          items: state.items.map((item) =>
            item.productId === product.id
              ? {
                  ...item,
                  ...toSnapshot(product),
                  quantity: nextQuantity,
                  notice: quantityNotice(requested, nextQuantity, limits),
                  isUnavailable: false,
                }
              : item,
          ),
        }
      }

      const newQuantity = clampQuantity(quantity, limits)
      const newItem = {
        productId: product.id,
        ...toSnapshot(product),
        quantity: newQuantity,
        notice: quantityNotice(quantity, newQuantity, limits),
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

          // Start with no notice: old messages (e.g. "out of stock" before a
          // restock) must not survive a refresh that found nothing wrong.
          const quantity = clampQuantity(item.quantity, limits)
          const oldSalePrice = getProductPricing(item).salePrice
          const newSalePrice = getProductPricing(fresh).salePrice
          let notice = quantityNotice(item.quantity, quantity, limits)
          if (!notice && oldSalePrice !== newSalePrice) {
            notice = `Price changed from ${formatPrice(oldSalePrice)} to ${formatPrice(newSalePrice)}.`
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
  const seen = new Set()
  const items = value.items.filter((item) => {
    const isValid =
      item &&
      Number.isInteger(item.productId) &&
      Number.isInteger(item.quantity) &&
      item.quantity > 0 &&
      typeof item.price === 'number' &&
      typeof item.title === 'string'
    if (!isValid || seen.has(item.productId)) return false // drop malformed and duplicate lines
    seen.add(item.productId)
    return true
  })
  return { items, couponCode: typeof value.couponCode === 'string' ? value.couponCode : null }
}
