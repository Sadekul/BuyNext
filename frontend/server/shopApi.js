import { json, readBody } from './http.js'
import { laravelShop } from './shop/laravel.js'
import { CUSTOMER, notSignedIn } from './session.js'

/*
 * BuyNest shop service, at /api/shop/* (storefront, VITE_API_PROVIDER=laravel).
 * Forwards to BuyNest's Laravel API (shop/laravel.js), which prices every
 * cart and order itself: the browser sends product ids and quantities, never
 * prices.
 *
 * GUESTS CAN BUY: an order is placed as the signed-in customer when the
 * customer session cookie is there (its token goes to Laravel), otherwise as
 * a guest, who can find the order later with its number and email.
 *
 *   POST /api/shop/cart/validate   { items: [{ productId, quantity }], couponCode, shippingMethod, email? } → priced cart
 *                                  (with the customer's token when signed in; a guest's email checks per-customer coupon limits)
 *   POST /api/shop/orders          { items, couponCode, shippingMethod, paymentMethod, email, phone,
 *                                    shippingAddress, billingAddress, expectedTotal } → 201 order
 *                                  409 { code: 'prices_changed', cart } · 422 { errors, problems? }
 *   GET  /api/shop/orders?page     → { orders, total, page, perPage, lastPage } (customer session)
 *   GET  /api/shop/orders/:number  → order (customer session; someone else's → 404)
 *   POST /api/shop/orders/lookup   { number, email } → order (guests)
 *   GET  /api/shop/orders/:number/invoices/:invoice → printable invoice (customer session; own orders only)
 *
 * Orders carry their documents (phase 3): shipments (carrier, tracking
 * number and link), invoices, and credit memos (refunds).
 */

const isOrderNumber = (value) => /^BN-\d{1,12}$/.test(value ?? '')
const isInvoiceNumber = (value) => /^INV-\d{1,12}$/.test(value ?? '')
const reply = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))

const ROUTES = {
  async 'POST cart/validate'({ request, cookies }) {
    return reply(await laravelShop.validateCart(await readBody(request), cookies[CUSTOMER.access], request))
  },

  async 'POST orders'({ request, cookies }) {
    // Signed in → the order belongs to the account; no cookie → a guest order.
    return reply(await laravelShop.placeOrder(await readBody(request), cookies[CUSTOMER.access], request), 201)
  },

  async 'GET orders'({ request, cookies, url }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn()
    const page = Math.min(Math.max(Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1), 10_000)
    return reply(await laravelShop.listOrders(cookies[CUSTOMER.access], page, request))
  },

  async 'GET orders/:number'({ request, cookies, param }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn()
    return reply(await laravelShop.getOrder(cookies[CUSTOMER.access], param, request))
  },

  async 'GET orders/:number/invoices/:invoice'({ request, cookies, param, invoice }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn()
    return reply(await laravelShop.getInvoice(cookies[CUSTOMER.access], param, invoice, request))
  },

  async 'POST orders/lookup'({ request }) {
    return reply(await laravelShop.lookupOrder(await readBody(request), request))
  },
}

/** /api/shop/<segments> → a route, or null. */
function matchRoute(method, segments) {
  const path = segments.join('/')
  if (ROUTES[`${method} ${path}`]) return { route: ROUTES[`${method} ${path}`] }
  if (segments.length === 2 && segments[0] === 'orders' && isOrderNumber(segments[1])) {
    return { route: ROUTES[`${method} orders/:number`], param: segments[1] }
  }
  if (segments.length === 4 && segments[0] === 'orders' && isOrderNumber(segments[1]) && segments[2] === 'invoices' && isInvoiceNumber(segments[3])) {
    return { route: ROUTES[`${method} orders/:number/invoices/:invoice`], param: segments[1], invoice: segments[3] }
  }
  return null
}

export async function handleShopRequest(request, segments, cookies) {
  const match = matchRoute(request.method, segments)
  if (!match?.route) return json({ message: 'Not found.' }, 404)
  return match.route({ request, cookies, url: new URL(request.url), param: match.param, invoice: match.invoice })
}
