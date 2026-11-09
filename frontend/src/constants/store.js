// Store-wide display settings. Values that affect money (shipping, discounts)
// are display-only on the frontend; the backend stays the source of truth.
export const STORE_SETTINGS = {
  locale: 'en-US',
  currency: 'USD',
  // A product shows a "sale" badge when its discount is at least this percentage.
  saleBadgeMinDiscount: 10,
}

/*
 * Cart pricing rules (DEMO VALUES, display only). The backend must
 * recalculate shipping, discounts, taxes, and totals before charging.
 */
export const SHIPPING_RULES = {
  freeShippingThreshold: 50, // order value (after discounts) for free standard shipping
  standardShippingCost: 4.99,
}

export const COUPONS = {
  NEST10: { type: 'percent', value: 10, description: '10% off your order' },
  SAVE20: { type: 'fixed', value: 20, minSubtotal: 150, description: '$20 off orders of $150 or more' },
}
