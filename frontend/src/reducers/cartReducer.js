import { formatBasePrice } from '../utils/formatters'
import { clampQuantity, getPurchaseLimits } from '../utils/inventory'
import { effectiveDiscountPercent, getProductPricing } from '../utils/pricing'
import { storedInteger, storedProductSnapshot, storedText } from '../utils/storedValues'
import { giftCardLineId, storedGiftCard } from '../utils/giftCards'
import { translate } from '../i18n'

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
  SAVED_CART_LOADED: 'cart/savedCartLoaded',
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
  // Phase 10: one gift card line per amount, recipient, and message (utils/giftCards.js).
  // (The server's priced lines carry the same details without the id: it is worked out the same way.)
  if (item.giftCard) return `${item.productId}:gc-${item.giftCard.id ?? giftCardLineId(item.giftCard)}`
  return item.variantId ? `${item.productId}:${item.variantId}` : String(item.productId)
}

/** The variant fields of a line, or nothing (lines without a variant keep their old shape). */
const variantFields = (variantId, variantLabel) => (variantId ? { variantId, variantLabel: variantLabel ?? null } : {})

/** Phase 10: a gift card line's fields (its type and recipient), or nothing for every other line. */
const giftCardFields = (giftCard) => (giftCard ? { productType: 'gift_card', giftCard } : {})

/** The line an action is about: `lineKey`, or (older callers) `productId` for a line without a variant. */
const actionKey = (action) => action.lineKey ?? String(action.productId)

/** Explains why the stored quantity differs from what was requested, or null. */
function quantityNotice(requested, actual, limits) {
  // Phase 13: written in the shopper's language when the change happens.
  if (actual < requested) return translate('cart:notices.onlyAvailable', { max: limits.max, quantity: actual })
  if (actual > requested) return translate('cart:notices.minimum', { min: limits.min, quantity: actual })
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
      // A gift card needs its amount and recipient (utils/giftCards.js withGiftCard).
      if (product.type === 'gift_card' && !product.giftCard) return state
      const key = cartLineKey({ productId: product.id, variantId: product.variantId, giftCard: product.giftCard })

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
        ...giftCardFields(product.giftCard),
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
          if (!fresh) return { ...item, isUnavailable: true, notice: translate('cart:notices.productGone') }
          // A gift card line keeps its chosen amount (the list only has the product's own price).
          if (item.giftCard) return { ...item, title: fresh.title ?? item.title, thumbnail: fresh.thumbnail ?? item.thumbnail, isUnavailable: false }
          // A variant line: the list only has the product's own price and total
          // stock, so the variant's price and stock stay as they were (the
          // server checks them again in cart/validate). The rest is refreshed.
          if (item.variantId) {
            if (fresh.hasVariants === false) return { ...item, isUnavailable: true, notice: translate('cart:notices.optionGone') }
            const { price, stock, availabilityStatus } = item
            return { ...item, ...toSnapshot(fresh), price, stock, availabilityStatus }
          }

          const limits = getPurchaseLimits(fresh)
          if (!limits.canBuy) {
            return { ...item, ...toSnapshot(fresh), isUnavailable: true, notice: translate('cart:notices.outOfStock') }
          }

          // Start with no notice: old messages (e.g. "out of stock" before a
          // restock) must not survive a refresh that found nothing wrong.
          const quantity = clampQuantity(item.quantity, limits)
          const oldSalePrice = getProductPricing(item).salePrice
          const newSalePrice = getProductPricing(fresh).salePrice
          let notice = quantityNotice(item.quantity, quantity, limits)
          if (!notice && oldSalePrice !== newSalePrice) {
            notice = translate('cart:notices.priceChanged', { from: formatBasePrice(oldSalePrice), to: formatBasePrice(newSalePrice) })
          }
          return { ...item, ...toSnapshot(fresh), quantity, isUnavailable: false, notice }
        }),
      }
    }

    // Another browser tab changed the cart.
    case CART_ACTIONS.REPLACED:
      return action.state

    // A signed-in customer's saved cart arrived from the server (phase 7,
    // hooks/useSavedCartSync.js). `mode: 'replace'`: the server's merged cart
    // becomes this cart; `mode: 'add'`: the lines' quantities are added.
    // Quantities stay within stock and the minimum order either way.
    case CART_ACTIONS.SAVED_CART_LOADED: {
      const lines = (action.lines ?? []).map(savedLineToItem).filter(Boolean)
      if (action.mode === 'replace') {
        const items = lines.map((line) => {
          const existing = state.items.find((item) => cartLineKey(item) === cartLineKey(line))
          const merged = existing ? { ...existing, ...line, brand: existing.brand, category: existing.category } : line
          return { ...merged, quantity: clampQuantity(line.quantity, getPurchaseLimits(merged)), notice: null, isUnavailable: false }
        })
        // Gift card lines live only in this browser (the saved cart holds products): they stay.
        return { ...state, items: [...items, ...state.items.filter((item) => item.giftCard)] }
      }
      const items = [...state.items]
      for (const line of lines) {
        const index = items.findIndex((item) => cartLineKey(item) === cartLineKey(line))
        if (index === -1) {
          items.push({ ...line, quantity: clampQuantity(line.quantity, getPurchaseLimits(line)) })
          continue
        }
        const merged = { ...items[index], ...line, brand: items[index].brand, category: items[index].category }
        items[index] = { ...merged, quantity: clampQuantity(items[index].quantity + line.quantity, getPurchaseLimits(merged)), isUnavailable: false }
      }
      return { ...state, items }
    }

    default:
      return state
  }
}

/** The availability label the cart shows, from a stock count. */
const availabilityOf = (stock) => {
  if (stock === null || stock === undefined) return null
  if (stock <= 0) return 'Out of Stock'
  return stock <= 5 ? 'Low Stock' : 'In Stock'
}

/**
 * A line of the customer's saved cart, as the shop service sends it
 * (server/shop/cart.js), → a cart item. Lines the cart can't sell
 * (no product id, no price, nothing in stock) give null.
 */
export function savedLineToItem(line) {
  if (!line || !Number.isInteger(line.productId) || line.productId < 1) return null
  if (typeof line.price !== 'number' || typeof line.title !== 'string' || !Number.isInteger(line.quantity) || line.quantity < 1) return null
  const item = {
    productId: line.productId,
    ...variantFields(Number.isInteger(line.variantId) && line.variantId > 0 ? line.variantId : null, line.variantLabel),
    title: line.title,
    brand: null,
    category: null,
    thumbnail: typeof line.thumbnail === 'string' ? line.thumbnail : null,
    price: line.price,
    // The server's sale price may come from a catalog price rule: shown as a discount.
    discountPercentage: effectiveDiscountPercent(line.price, line.discountPercentage ?? 0, line.salePrice ?? null),
    stock: Number.isInteger(line.stock) ? line.stock : null,
    minimumOrderQuantity: Number.isInteger(line.minimumOrderQuantity) ? line.minimumOrderQuantity : 1,
    availabilityStatus: availabilityOf(line.stock),
    quantity: line.quantity,
    notice: null,
    isUnavailable: false,
  }
  return getPurchaseLimits(item).canBuy ? item : null
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
    // A gift card line without valid recipient details can't be bought: it is dropped.
    const giftCard = stored.productType === 'gift_card' || stored.giftCard ? storedGiftCard(stored.giftCard) : null
    if ((stored.productType === 'gift_card' || stored.giftCard) && !giftCard) continue
    const item = {
      productId: stored.productId,
      ...variantFields(variantId, storedText(stored.variantLabel)),
      ...giftCardFields(giftCard),
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
