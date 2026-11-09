import { COUPONS, SHIPPING_RULES } from '../constants/store'
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
 * Totals for the purchasable lines of a cart.
 * Unavailable lines (`isUnavailable`) are listed but never charged.
 */
export function calculateCartTotals(items, couponCode = null) {
  const lines = items.filter((item) => !item.isUnavailable)

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
  const shippingCents = itemCount === 0 || qualifiesForFreeShipping ? 0 : toCents(SHIPPING_RULES.standardShippingCost)

  return {
    itemCount,
    subtotal: toDollars(subtotalCents),
    productSavings: toDollars(originalCents - subtotalCents),
    coupon,
    couponError,
    discount: toDollars(discountCents),
    shipping: toDollars(shippingCents),
    amountToFreeShipping: toDollars(Math.max(0, thresholdCents - afterDiscountCents)),
    total: toDollars(afterDiscountCents + shippingCents),
  }
}
