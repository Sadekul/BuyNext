import { ApiError, apiClient } from './apiClient'
import { normalizePhone } from '../utils/validation'
import { giftCardPayload } from '../utils/giftCards'
import { normalizeProduct } from './adapters/laravelAdapter'
import { translate } from '../i18n'

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
// A gift card line (phase 10) carries its amount and recipient.
const cartLines = (items) =>
  items
    .filter((item) => !item.isUnavailable)
    .map((item) => ({
      productId: item.productId,
      ...(item.variantId && { variantId: item.variantId }),
      quantity: item.quantity,
      ...(item.giftCard && { giftCard: giftCardPayload(item.giftCard) }),
    }))

/**
 * POST /api/shop/products/:id/reviews { rating, title?, comment } → the new review
 * (signed-in customer). `status` is "pending" until a moderator approves it,
 * or "approved" when the store publishes reviews straight away.
 * ApiError 422 with data.code "already_reviewed" for a second review.
 */
export function submitReview(productId, { rating, title, comment, photos = [] }) {
  const path = `/api/shop/products/${encodeURIComponent(productId)}/reviews`
  if (photos.length === 0) return apiClient.post(path, { rating, title: title || null, comment }, SHOP)
  // Phase 22: with photos, a form upload (rating, title, comment, photos[]); a slow mobile upload gets a minute.
  const form = new FormData()
  form.append('rating', String(rating))
  form.append('title', title || '')
  form.append('comment', comment)
  for (const photo of photos) form.append('photos[]', photo, photo.name)
  return apiClient.post(path, form, { ...SHOP, timeoutMs: 60_000 })
}

/**
 * POST /api/shop/cart/validate → { lines, problems, coupon, couponError, shippingOptions, totals,
 * crossSells (phase 11: BuyNest products), rewards, rewardPoints, rewardPointsError }.
 * `problems`: [{ productId, code: unavailable | insufficient_stock | below_minimum, message }].
 * The server decides whether the coupon applies (`coupon` or `couponError`). A
 * guest's `email` lets it check "one use per customer" before checkout; a
 * signed-in customer is recognised by the session cookie. The shipping
 * `country` (sent only when the store charges tax) lets the server work out the tax.
 */
export async function validateCart({ items, couponCode, shippingMethod, email, country, giftCardCode, rewardPoints, place, paymentMethod }, { signal } = {}) {
  const body = {
    items: cartLines(items),
    couponCode: couponCode || null,
    // null: a cart of gift cards only (phase 10), which needs no delivery. Left out: standard delivery.
    ...(shippingMethod !== undefined && { shippingMethod }),
    ...(email && { email }),
    ...(country && { country }),
    ...(giftCardCode && { giftCardCode }),
    // Phase 11: reward points to spend (signed-in customers; the server checks every limit).
    ...(rewardPoints > 0 && { rewardPoints }),
    // Phase 14: a Bangladesh address's place (its delivery zone prices delivery), and the payment
    // method when cash on delivery has rules (fee, limit, zones); left out otherwise.
    ...(place?.areaId && { place: { divisionId: place.divisionId, districtId: place.districtId, areaId: place.areaId } }),
    ...(paymentMethod && { paymentMethod }),
  }
  const cart = await apiClient.post('/api/shop/cart/validate', body, { ...SHOP, signal })
  // Phase 11: "Customers also bought" arrive as the API's product cards (like the catalog's).
  return { ...cart, crossSells: (Array.isArray(cart?.crossSells) ? cart.crossSells : []).filter((product) => product?.id).map(normalizeProduct) }
}

/**
 * POST /api/shop/orders → the new order (201). Guests and signed-in customers
 * alike; the server attaches the order to the account when there is a session.
 * ApiError 409 (data.cart: the new prices) or 422 (fieldErrors, data.problems).
 * `values.saveAddress` (signed in) keeps the shipping address in the address
 * book; the server skips it when the book is full or already has it.
 */
export function placeOrder({ items, couponCode, values, expectedTotal, giftCardCode, rewardPoints, requiresShipping = true }) {
  const { shipping, billingSameAsShipping, billing } = values
  return apiClient.post(
    '/api/shop/orders',
    {
      items: cartLines(items),
      couponCode: couponCode || null,
      // Phase 10: a cart of gift cards only has no delivery: no method. The form asks for one
      // address (billing); the API still keeps an address on the order, so it goes as both.
      shippingMethod: requiresShipping ? values.shippingMethod : null,
      paymentMethod: values.paymentMethod,
      email: values.email.trim(),
      phone: normalizePhone(values.phone),
      shippingAddress: requiresShipping ? shipping : billing,
      billingAddress: requiresShipping && !billingSameAsShipping ? billing : null,
      expectedTotal,
      ...(giftCardCode && { giftCardCode }),
      // Phase 11: reward points spent on this order (signed in), paid before a gift card.
      ...(rewardPoints > 0 && { rewardPoints }),
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

/**
 * Phase 10: POST /api/shop/orders/:number/paypal/capture { token, email? } →
 * the order. Back from PayPal (?payment=success&provider=paypal&token=…), the
 * server captures the approved payment and checks it. A guest proves the
 * order is theirs with its email. ApiError 422 when PayPal refused it.
 */
export function capturePaypal(number, { token, email } = {}) {
  return apiClient.post(`/api/shop/orders/${encodeURIComponent(number)}/paypal/capture`, { token, ...(email && { email: email.trim() }) }, SHOP)
}

/**
 * Phase 10: POST /api/shop/gift-cards/check { code } → { balance, currency,
 * expiresAt, status }. ApiError 422 (the same for unknown and disabled codes), 429 when asked too often.
 */
export function checkGiftCard(code, { signal } = {}) {
  return apiClient.post('/api/shop/gift-cards/check', { code }, { ...SHOP, signal })
}

/**
 * Phase 10: an invoice as a PDF → { blob, fileName }. Signed-in customers:
 * GET with the session; a guest: POST with the order's email (the proof).
 * Errors become ApiError like every other call.
 */
export async function getInvoicePdf(number, invoice, { email } = {}) {
  const path = `/api/shop/orders/${encodeURIComponent(number)}/invoices/${encodeURIComponent(invoice)}.pdf`
  let response
  try {
    response = await fetch(new URL(path, window.location.origin), {
      method: email ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/pdf, application/json', ...(email && { 'Content-Type': 'application/json' }) },
      body: email ? JSON.stringify({ email: email.trim() }) : undefined,
      signal: AbortSignal.timeout(60_000),
    })
  } catch (error) {
    throw new ApiError(translate(error?.name === 'TimeoutError' ? 'errors:api.timeout' : 'errors:api.network'))
  }
  const type = response.headers.get('content-type') ?? ''
  if (!response.ok || !type.includes('application/pdf')) {
    const data = await response.json().catch(() => null)
    const fallback = translate(response.status === 404 ? 'errors:pdf.notFound' : 'errors:pdf.failed')
    throw new ApiError(data?.message ?? fallback, { status: response.ok ? 502 : response.status, data })
  }
  const match = /filename="?([\w.-]+\.pdf)"?/i.exec(response.headers.get('content-disposition') ?? '')
  return { blob: await response.blob(), fileName: match?.[1] ?? `${invoice}.pdf` }
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

/**
 * POST /api/shop/orders/:number/cancel { reason?, email? } → the cancelled
 * order (phase 9). Signed-in customers are recognised by the session; a
 * guest proves the order is theirs with its email. Only unpaid orders with
 * nothing invoiced or shipped (`order.canCancel`): otherwise ApiError 422
 * whose message says to contact the store.
 */
export function cancelOrder(number, { reason, email } = {}) {
  const body = { ...(reason?.trim() && { reason: reason.trim() }), ...(email && { email: email.trim() }) }
  return apiClient.post(`/api/shop/orders/${encodeURIComponent(number)}/cancel`, body, SHOP)
}

/*
 * Phase 20: the one-tap link in the cash on delivery text (/c/:token). No
 * sign-in: the token is the proof. GET only reads (link previews and SMS apps
 * open links); POST answers it. ApiError 404 for an expired or unknown link,
 * 422 when the order can't be cancelled any more, 429 after too many tries.
 */

/** GET /api/shop/order-confirmations/:token → { number, total, itemsCount, placedAt, status }. */
export function getOrderConfirmation(token, { signal } = {}) {
  return apiClient.get(`/api/shop/order-confirmations/${encodeURIComponent(token)}`, { ...SHOP, signal })
}

/** POST /api/shop/order-confirmations/:token { action: 'confirm' | 'cancel', reason? } → the summary with its new status. */
export function answerOrderConfirmation(token, { action, reason } = {}) {
  const body = { action, ...(action === 'cancel' && reason?.trim() && { reason: reason.trim() }) }
  return apiClient.post(`/api/shop/order-confirmations/${encodeURIComponent(token)}`, body, SHOP)
}
