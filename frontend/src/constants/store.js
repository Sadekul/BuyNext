// Store-wide display settings. Values that affect money (shipping, discounts)
// are display-only on the frontend; the backend stays the source of truth.
export const STORE_SETTINGS = {
  locale: 'en-US',
  currency: 'USD', // phase 12: only the fallback until the store settings load (GET /store `currency`)
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

/*
 * Checkout options (DEMO). Prices are display estimates; the backend
 * confirms the real shipping cost for the address and method.
 */
export const SHIPPING_METHODS = [
  { id: 'standard', label: 'Standard', eta: '3–5 business days', price: null }, // price follows SHIPPING_RULES
  { id: 'express', label: 'Express', eta: '1–2 business days', price: 12.99 },
  { id: 'nextDay', label: 'Next day', eta: 'Next business day (order by 2 pm)', price: 24.99 },
]

// No card fields anywhere in BuyNest: card details must be entered on a
// PCI-compliant payment provider's page (e.g. Stripe Checkout), never here.
export const PAYMENT_METHODS = [
  {
    id: 'card',
    label: 'Credit or debit card',
    description: "You'll enter your card on our payment partner's secure page. BuyNest never sees your card number.",
  },
  { id: 'paypal', label: 'PayPal', description: "You'll confirm the payment in your PayPal account." },
  { id: 'cod', label: 'Cash on delivery', description: 'Pay the courier when your order arrives.' },
]

/*
 * Phase 12: SSLCommerz's hosted page (bKash, Nagad, Rocket, cards, internet
 * banking). Only offered by a real store charging in taka, never in the demo
 * (so it isn't in PAYMENT_METHODS). `badges`: the methods as plain text
 * marks (no third-party logos fetched from elsewhere).
 */
export const SSLCOMMERZ_METHOD = {
  id: 'sslcommerz',
  label: 'bKash, Nagad or card (SSLCommerz)',
  description: "You'll finish paying on SSLCommerz's secure page.",
  badges: ['bKash', 'Nagad', 'Card'],
}

/** Every payment method BuyNest knows (labels for the server's ids and for orders). */
export const ALL_PAYMENT_METHODS = [...PAYMENT_METHODS, SSLCOMMERZ_METHOD]

export const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'Bangladesh', 'India']
