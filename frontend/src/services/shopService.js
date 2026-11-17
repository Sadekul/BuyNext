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

// A variant line (phase 5) also names its variant; lines without one are sent exactly as before.
const cartLines = (items) =>
  items
    .filter((item) => !item.isUnavailable)
    .map((item) => ({ productId: item.productId, ...(item.variantId && { variantId: item.variantId }), quantity: item.quantity }))

/**
 * POST /api/shop/products/:id/reviews { rating, title?, comment } → the new review
 * (signed-in customer). `status` is "pending" until a moderator approves it,
 * or "approved" when the store publishes reviews straight away.
 * ApiError 422 with data.code "already_reviewed" for a second review.
 */
export function submitReview(productId, { rating, title, comment }) {
  return apiClient.post(`/api/shop/products/${encodeURIComponent(productId)}/reviews`, { rating, title: title || null, comment }, SHOP)
}

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
 * `values.saveAddress` (signed in) keeps the shipping address in the address
 * book; the server skips it when the book is full or already has it.
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
      // Signed-in customers (phase 6): add the shipping address to the address book afterwards.
      ...(values.saveAddress === true && { saveAddress: true }),
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

/**
 * POST /api/shop/orders/:number/pay { email? } → { provider, url, expiresAt }:
 * a new Stripe payment page for an unpaid card order (phase 8). Signed-in
 * customers are recognised by the session cookie; a guest proves the order
 * is theirs with its email, like the order lookup. ApiError 422 when the
 * order can't be paid any more (paid, cancelled, or not a card order).
 */
export function payOrder(number, { email } = {}) {
  return apiClient.post(`/api/shop/orders/${encodeURIComponent(number)}/pay`, email ? { email: email.trim() } : {}, SHOP)
}

/**
 * GET /api/shop/me/cart → { items, itemCount, updatedAt }: the signed-in
 * customer's saved cart (phase 7), as priced cart lines ({ productId,
 * variantId?, variantLabel?, title, thumbnail, price, salePrice,
 * discountPercentage, stock, minimumOrderQuantity, quantity }). Sold-out
 * items are left out; quantities are capped by stock.
 */
export function getSavedCart({ signal } = {}) {
  return apiClient.get('/api/shop/me/cart', { ...SHOP, signal })
}

/**
 * POST /api/shop/me/cart/merge { items } → the saved cart after ADDING these
 * lines to it (same answer as getSavedCart). Only once per sign-in, with the
 * lines the server doesn't have yet: calling it twice adds them twice.
 */
export function mergeSavedCart(items, { signal } = {}) {
  const lines = items.map((item) => ({ productId: item.productId, ...(item.variantId && { variantId: item.variantId }), quantity: item.quantity }))
  return apiClient.post('/api/shop/me/cart/merge', { items: lines }, { ...SHOP, signal })
}
