import { COUPONS, SHIPPING_METHODS, SHIPPING_RULES } from '../constants/store'
import { getProductPricing } from './pricing'

const DEMO_RULES = {
  shippingMethods: SHIPPING_METHODS,
  standardShippingCost: SHIPPING_RULES.standardShippingCost,
  freeShippingThreshold: SHIPPING_RULES.freeShippingThreshold,
}

/*
 * Cart math, done in whole CENTS to avoid floating-point errors
 * (0.1 + 0.2 !== 0.3 in JavaScript). Convert back to dollars at the end.
 * DISPLAY ONLY: the backend recalculates everything at checkout.
 */
const toCents = (dollars) => Math.round(dollars * 100)
const toDollars = (cents) => cents / 100

/** Checks a coupon code against the explicit rules in constants/store.js. */
export function evaluateCoupon(code, subtotalCents) {
  if (!code) return { coupon: null, discountCents: 0, error: null }

  const coupon = COUPONS[code.trim().toUpperCase()]
  if (!coupon) return { coupon: null, discountCents: 0, error: 'This code is not valid.' }

  if (coupon.minSubtotal && subtotalCents < toCents(coupon.minSubtotal)) {
    return { coupon, discountCents: 0, error: `Spend at least $${coupon.minSubtotal} to use this code.` }
  }

  const rawDiscount = coupon.type === 'percent' ? Math.round((subtotalCents * coupon.value) / 100) : toCents(coupon.value)
  return { coupon, discountCents: Math.min(rawDiscount, subtotalCents), error: null }
}

/**
 * How much more MERCHANDISE (before the coupon) reaches the free-shipping
 * threshold. With a percent coupon, $1 of items adds less than $1 after the
 * discount, so the gap is grossed up, then checked against the real coupon
 * math (which rounds to the cent).
 */
function amountToFreeShippingCents(subtotalCents, couponCode, thresholdCents) {
  const afterDiscount = (cents) => cents - evaluateCoupon(couponCode, cents).discountCents
  const gapCents = thresholdCents - afterDiscount(subtotalCents)
  if (gapCents <= 0) return 0

  const { coupon, error } = evaluateCoupon(couponCode, subtotalCents)
  const percentOff = coupon?.type === 'percent' && !error ? coupon.value : 0
  if (percentOff >= 100) return 0 // every item would be free: no amount closes the gap
  let extraCents = Math.ceil((gapCents * 100) / (100 - percentOff))
  while (afterDiscount(subtotalCents + extraCents) < thresholdCents) extraCents += 1
  return extraCents
}

/**
 * Totals for the purchasable lines of a cart.
 * Unavailable lines (`isUnavailable`) are listed but never charged.
 * `shippingMethodId`: 'standard' follows the free-shipping threshold;
 * other methods have a flat price. `rules` are the store's shipping rules:
 * the demo's constants/store.js, or the server's settings in REAL_SHOP
 * (hooks/useStoreSettings.js).
 */
export function calculateCartTotals(items, couponCode = null, shippingMethodId = 'standard', rules = DEMO_RULES) {
  const lines = items.filter((item) => !item.isUnavailable)
  const unavailableCount = items.length - lines.length
  // Phase 10: gift cards are emailed; a cart of gift cards only has nothing to ship.
  const requiresShipping = lines.length === 0 || lines.some((line) => !line.giftCard)

  let itemCount = 0
  let originalCents = 0
  let subtotalCents = 0
  let giftCardCents = 0 // phase 10: gift cards don't count toward free shipping
  for (const line of lines) {
    const { salePrice, originalPrice } = getProductPricing(line)
    itemCount += line.quantity
    originalCents += toCents(originalPrice) * line.quantity
    subtotalCents += toCents(salePrice) * line.quantity
    if (line.giftCard) giftCardCents += toCents(salePrice) * line.quantity
  }

  const { coupon, discountCents, error: couponError } = evaluateCoupon(couponCode, subtotalCents)
  const afterDiscountCents = subtotalCents - discountCents
  const methods = rules.shippingMethods.length > 0 ? rules.shippingMethods : SHIPPING_METHODS
  // Free shipping is a standard-delivery rule: without standard delivery (or a threshold) there is none.
  const freeShippingThreshold = requiresShipping && methods.some((option) => option.id === 'standard') ? rules.freeShippingThreshold : null
  const thresholdCents = freeShippingThreshold === null ? null : toCents(freeShippingThreshold)
  const qualifiesForFreeShipping = thresholdCents !== null && afterDiscountCents - giftCardCents >= thresholdCents
  const method = methods.find((option) => option.id === shippingMethodId) ?? methods[0]
  let shippingCents = 0
  if (itemCount > 0 && requiresShipping) {
    if (method.price !== null) shippingCents = toCents(method.price)
    else if (!qualifiesForFreeShipping) shippingCents = toCents(rules.standardShippingCost)
  }

  return {
    itemCount, // purchasable units (used for the subtotal)
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0), // every unit in the cart (badge)
    unavailableCount,
    canCheckout: lines.length > 0 && unavailableCount === 0,
    subtotal: toDollars(subtotalCents),
    productSavings: toDollars(originalCents - subtotalCents),
    coupon,
    couponError,
    discount: toDollars(discountCents),
    shippingMethod: method,
    requiresShipping,
    shipping: toDollars(shippingCents),
    freeShippingThreshold,
    amountToFreeShipping: thresholdCents === null ? null : toDollars(amountToFreeShippingCents(subtotalCents - giftCardCents, couponCode, thresholdCents)),
    total: toDollars(afterDiscountCents + shippingCents),
  }
}

/**
 * REAL_SHOP: the local totals (no coupon) with the server's answer from
 * cart/validate laid over them: its prices, discount, shipping, and its
 * verdict on the coupon. Until the answer arrives, no coupon is shown as
 * applied. Free shipping is measured, like the server does, on the
 * merchandise after the coupon.
 */
export function withServerPricing(localTotals, serverCart) {
  if (!serverCart) return { ...localTotals, coupon: null, couponError: null }
  const { totals } = serverCart
  const base = {
    ...localTotals,
    itemCount: totals.itemCount,
    subtotal: totals.subtotal,
    discount: totals.discount,
    shipping: totals.shipping,
    tax: totals.tax,
    total: totals.total,
    coupon: serverCart.coupon,
    couponError: serverCart.couponError,
    // Phase 7: each cart price rule that applied (automatic ones too), for the summary rows.
    appliedRules: serverCart.appliedRules ?? [],
  }
  // Gift card lines (phase 10) don't count toward free shipping.
  const giftCardCents = (serverCart.lines ?? []).filter((line) => line.giftCard).reduce((sum, line) => sum + toCents(line.lineTotal ?? 0), 0)
  const afterDiscountCents = toCents(totals.subtotal) - toCents(totals.discount) - giftCardCents
  // Totals built without store rules (older callers) use the demo threshold.
  const freeShippingThreshold = localTotals.freeShippingThreshold === undefined ? SHIPPING_RULES.freeShippingThreshold : localTotals.freeShippingThreshold
  if (freeShippingThreshold === null) return { ...base, amountToFreeShipping: null }
  const gapCents = toCents(freeShippingThreshold) - afterDiscountCents
  return {
    ...base,
    // Free shipping already (threshold reached, or a free-shipping code): nothing left to add.
    amountToFreeShipping: totals.shipping === 0 || gapCents <= 0 ? 0 : toDollars(gapCents),
  }
}
