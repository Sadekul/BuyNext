import { COUPONS, SHIPPING_METHODS, SHIPPING_RULES } from '../constants/store'
import { getProductPricing } from './pricing'

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
 * other methods have a flat price (constants/store.js).
 */
export function calculateCartTotals(items, couponCode = null, shippingMethodId = 'standard') {
  const lines = items.filter((item) => !item.isUnavailable)
  const unavailableCount = items.length - lines.length

  let itemCount = 0
  let originalCents = 0
  let subtotalCents = 0
  for (const line of lines) {
    const { salePrice, originalPrice } = getProductPricing(line)
    itemCount += line.quantity
    originalCents += toCents(originalPrice) * line.quantity
    subtotalCents += toCents(salePrice) * line.quantity
  }

  const { coupon, discountCents, error: couponError } = evaluateCoupon(couponCode, subtotalCents)
  const afterDiscountCents = subtotalCents - discountCents
  const thresholdCents = toCents(SHIPPING_RULES.freeShippingThreshold)
  const qualifiesForFreeShipping = afterDiscountCents >= thresholdCents
  const method = SHIPPING_METHODS.find((option) => option.id === shippingMethodId) ?? SHIPPING_METHODS[0]
  let shippingCents = 0
  if (itemCount > 0) {
    if (method.price !== null) shippingCents = toCents(method.price)
    else if (!qualifiesForFreeShipping) shippingCents = toCents(SHIPPING_RULES.standardShippingCost)
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
    shipping: toDollars(shippingCents),
    amountToFreeShipping: toDollars(amountToFreeShippingCents(subtotalCents, couponCode, thresholdCents)),
    total: toDollars(afterDiscountCents + shippingCents),
  }
}
