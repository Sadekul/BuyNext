import { formatPrice } from '../utils/formatters'
import { clampQuantity, getPurchaseLimits } from '../utils/inventory'
import { getProductPricing } from '../utils/pricing'
import { storedInteger, storedProductSnapshot, storedText } from '../utils/storedValues'

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
  ORDER_PLACED: 'cart/orderPlaced',
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

/*
 * A cart line is one product, or one VARIANT of a configurable product
 * (phase 5): the same T-shirt in M and in L is two lines. Variant lines
 * carry `variantId` and `variantLabel` ("Size: M / Color: Red"); lines
 * without a variant have neither key, exactly as carts saved before variants.
 */
export function cartLineKey(item) {
  return item.variantId ? `${item.productId}:${item.variantId}` : String(item.productId)
}

/** The variant fields of a line, or nothing (lines without a variant keep their old shape). */
const variantFields = (variantId, variantLabel) => (variantId ? { variantId, variantLabel: variantLabel ?? null } : {})

/** The line an action is about: `lineKey`, or (older callers) `productId` for a line without a variant. */
const actionKey = (action) => action.lineKey ?? String(action.productId)

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
      // A configurable product sells only through a variant (utils/variants.js withVariant).
      if (product.hasVariants && !product.variantId) return state
      const key = cartLineKey({ productId: product.id, variantId: product.variantId })

      // Tell the shopper when the requested amount had to be capped by stock.
      const existing = state.items.find((item) => cartLineKey(item) === key)
      if (existing) {
        const requested = existing.quantity + quantity
        const nextQuantity = clampQuantity(requested, limits)
        return {
          ...state,
          items: state.items.map((item) =>
            cartLineKey(item) === key
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
        ...variantFields(product.variantId, product.variantLabel),
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
          cartLineKey(item) === actionKey(action)
            ? { ...item, quantity: clampQuantity(action.quantity, getPurchaseLimits(item)), notice: null }
            : item,
        ),
      }

    case CART_ACTIONS.REMOVED:
      return { ...state, items: state.items.filter((item) => cartLineKey(item) !== actionKey(action)) }

    case CART_ACTIONS.CLEARED:
      return EMPTY_CART

    // Remove only the lines that were ordered: anything added meanwhile (for
    // example in another tab) stays. The coupon was used by the order.
    case CART_ACTIONS.ORDER_PLACED: {
      // `lineKeys` (cartLineKey); older callers pass the product ids of lines without variants.
      const ordered = new Set(action.lineKeys ?? action.productIds.map(String))
      return { items: state.items.filter((item) => !ordered.has(cartLineKey(item))), couponCode: null }
    }

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
          // A variant line: the list only has the product's own price and total
          // stock, so the variant's price and stock stay as they were (the
          // server checks them again in cart/validate). The rest is refreshed.
          if (item.variantId) {
            if (fresh.hasVariants === false) return { ...item, isUnavailable: true, notice: 'This option is no longer available.' }
            const { price, stock, availabilityStatus } = item
            return { ...item, ...toSnapshot(fresh), price, stock, availabilityStatus }
          }

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

/**
 * Guest cart → account cart, when a customer signs in. Lines for the same
 * product keep the larger quantity (both are already within stock limits,
 * and adding them could double an item by surprise). The account's coupon
 * wins; otherwise the guest's carries over.
 */
export function mergeCarts(accountCart, guestCart) {
  const items = [...accountCart.items]
  for (const guestItem of guestCart.items) {
    const index = items.findIndex((item) => cartLineKey(item) === cartLineKey(guestItem))
    if (index === -1) items.push(guestItem)
    else items[index] = { ...items[index], quantity: Math.max(items[index].quantity, guestItem.quantity) }
  }
  return { items, couponCode: accountCart.couponCode ?? guestCart.couponCode }
}

/**
 * Validates data loaded from storage (on start-up and from other tabs).
 * Each line is rebuilt from known fields with checked types; malformed and
 * duplicate lines are dropped.
 */
export function sanitizeCart(value) {
  if (!value || !Array.isArray(value.items)) return EMPTY_CART
  const seen = new Set()
  const items = []
  for (const stored of value.items) {
    if (!stored || !Number.isInteger(stored.productId)) continue
    if (!Number.isInteger(stored.quantity) || stored.quantity < 1) continue
    // Carts saved before variants have no variantId: they load as plain lines.
    const variantId = storedInteger(stored.variantId, 1)
    const item = {
      productId: stored.productId,
      ...variantFields(variantId, storedText(stored.variantLabel)),
      ...storedProductSnapshot(stored),
      quantity: stored.quantity,
      notice: storedText(stored.notice),
    }
    if (item.title === null || item.price === null || seen.has(cartLineKey(item))) continue
    seen.add(cartLineKey(item))
    items.push(item)
  }
  return { items, couponCode: storedText(value.couponCode) }
}
