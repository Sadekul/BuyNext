import { apiClient } from './apiClient'
import { normalizePhone } from '../utils/validation'

/*
 * Carts and orders with BuyNest's Laravel API, through the shop service on
 * this site's own address (/api/shop, frontend/server/shopApi.js). Used when
 * REAL_SHOP is on (constants/shop.js); the demo uses orderService.js.
 *
 * THE SERVER PRICES EVERYTHING: these calls send product ids, quantities, the
 * coupon code, and the chosen methods, never prices. `expectedTotal` is only
 * the total the shopper saw: if the server's differs, it refuses the order
 * (409) and sends the new prices instead.
 *
 * Money arrives as numbers, in the storefront's camelCase shapes.
 */

const SHOP = { sameOrigin: true } // the customer session cookie, when signed in

const cartLines = (items) => items.filter((item) => !item.isUnavailable).map((item) => ({ productId: item.productId, quantity: item.quantity }))

/**
 * POST /api/shop/cart/validate → { lines, problems, coupon, couponError, shippingOptions, totals }.
 * `problems`: [{ productId, code: unavailable | insufficient_stock | below_minimum, message }].
 * The server decides whether the coupon applies (`coupon` or `couponError`). A
 * guest's `email` lets it check "one use per customer" before checkout; a
 * signed-in customer is recognised by the session cookie. The shipping
 * `country` (sent only when the store charges tax) lets the server work out the tax.
 */
export function validateCart({ items, couponCode, shippingMethod, email, country }, { signal } = {}) {
  const body = { items: cartLines(items), couponCode: couponCode || null, shippingMethod, ...(email && { email }), ...(country && { country }) }
  return apiClient.post('/api/shop/cart/validate', body, { ...SHOP, signal })
}

/**
 * POST /api/shop/orders → the new order (201). Guests and signed-in customers
 * alike; the server attaches the order to the account when there is a session.
 * ApiError 409 (data.cart: the new prices) or 422 (fieldErrors, data.problems).
 */
export function placeOrder({ items, couponCode, values, expectedTotal }) {
  const { shipping, billingSameAsShipping, billing } = values
  return apiClient.post(
    '/api/shop/orders',
    {
      items: cartLines(items),
      couponCode: couponCode || null,
      shippingMethod: values.shippingMethod,
      paymentMethod: values.paymentMethod,
      email: values.email.trim(),
      phone: normalizePhone(values.phone),
      shippingAddress: shipping,
      billingAddress: billingSameAsShipping ? null : billing,
      expectedTotal,
    },
    SHOP,
  )
}

/** GET /api/shop/orders?page → { orders, total, page, perPage, lastPage } (signed-in customer). */
export function getOrders({ page = 1, signal } = {}) {
  return apiClient.get('/api/shop/orders', { ...SHOP, params: { page }, signal })
}

/** GET /api/shop/orders/:number → one of the signed-in customer's orders (404 otherwise). */
export function getOrder(number, { signal } = {}) {
  return apiClient.get(`/api/shop/orders/${encodeURIComponent(number)}`, { ...SHOP, signal })
}

/** GET /api/shop/orders/:number/invoices/:invoice → a printable invoice of the customer's own order (404 otherwise). */
export function getInvoice(number, invoice, { signal } = {}) {
  return apiClient.get(`/api/shop/orders/${encodeURIComponent(number)}/invoices/${encodeURIComponent(invoice)}`, { ...SHOP, signal })
}

/** POST /api/shop/orders/lookup { number, email } → the order (guests). 404 when either doesn't match. */
export function lookupOrder({ number, email }, { signal } = {}) {
  return apiClient.post('/api/shop/orders/lookup', { number: number.trim().toUpperCase(), email: email.trim() }, { ...SHOP, signal })
}
