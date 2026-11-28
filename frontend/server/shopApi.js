import { json, multipartType, readBody, readLimitedBody } from './http.js'
import { serverMessage } from './i18n.js'
import { laravelShop } from './shop/laravel.js'
import { laravelCustomer } from './shop/customer.js'
import { laravelNewsletter } from './shop/newsletter.js'
import { laravelCart } from './shop/cart.js'
import { laravelAccount } from './shop/account.js'
import { isShareToken, laravelRewards, laravelWishlist } from './shop/phase11.js'
import { laravelOrderConfirmations } from './shop/orderConfirmations.js'
import { CUSTOMER, clearedCookies, notSignedIn } from './session.js'

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
 *   POST /api/shop/cart/validate   { items: [{ productId, quantity }], couponCode, shippingMethod, email?, country? } → priced cart
 *                                  (with the customer's token when signed in; a guest's email checks per-customer coupon limits)
 *   POST /api/shop/orders          { items, couponCode, shippingMethod, paymentMethod, email, phone,
 *                                    shippingAddress, billingAddress, expectedTotal } → 201 order
 *                                  409 { code: 'prices_changed', cart } · 422 { errors, problems? }
 *   GET  /api/shop/orders?page     → { orders, total, page, perPage, lastPage } (customer session)
 *   GET  /api/shop/orders/:number  → order (customer session; someone else's → 404)
 *   POST /api/shop/orders/lookup   { number, email } → order (guests)
 *   POST /api/shop/orders/:number/pay { email? } → { provider, url, expiresAt } (phase 8: a new Stripe
 *                                  Checkout page for an unpaid card order; customer session, or a guest's
 *                                  order email; 422 when the order can't be paid)
 *   GET  /api/shop/orders/:number/invoices/:invoice → printable invoice (customer session; own orders only)
 *   POST /api/shop/products/:id/reviews { rating, title?, comment } → 201 review (customer session; phase 5)
 *                                  422 { code: 'already_reviewed' } for a second review of the same product
 *                                  Phase 22: also multipart/form-data (rating, title, comment, photos[] with 0–3 files),
 *                                  passed through unparsed, at most 16 MB (over → 422 errors.photos); the review then
 *                                  carries `photos: [{ id, url, width, height }]` and the API's `photos` / `photos.N`
 *                                  errors and `code: 'photos_disabled'` go through
 *
 * Phase 6, customer session only (shop/customer.js):
 *   GET    /api/shop/me/addresses              → { addresses } (the address book)
 *   POST   /api/shop/me/addresses              { firstName, lastName, phone?, company?, line1, line2?, city, state,
 *                                                postalCode, country, isDefaultShipping?, isDefaultBilling? } → 201 address
 *   PATCH  /api/shop/me/addresses/:id          (any of those fields) → address
 *   DELETE /api/shop/me/addresses/:id          → { ok: true }
 *   POST   /api/shop/orders/:number/returns    { items: [{ orderItemId, quantity }], reason, comment? } → 201 return
 *   GET    /api/shop/returns?page              → { returns, total, page, perPage, lastPage }
 *   GET    /api/shop/returns/:number           → return (someone else's → 404)
 * POST /api/shop/orders also takes `saveAddress: true` (signed in: the
 * shipping address goes into the address book after the order is placed).
 *
 * Phase 7:
 *   POST /api/shop/newsletter              { email, source? } → 202 { message } (the same answer for every address)
 *   POST /api/shop/newsletter/confirm      { token } → { message, email, status }   (the link in the confirmation email)
 *   POST /api/shop/newsletter/unsubscribe  { token } → { message, email, status }   (the link in every newsletter)
 *   GET  /api/shop/me/cart                 → { items, itemCount, updatedAt } (customer session: the saved cart, priced lines)
 *   POST /api/shop/me/cart/merge           { items: [{ productId, variantId?, quantity }] } → the same, after adding these lines
 *
 * Phase 8 (Stripe): POST /api/shop/orders answers with `payment: { provider,
 * url, expiresAt }` for card orders when the store takes card payments (url
 * null + `error` when Stripe couldn't be reached: the order exists and "Pay
 * now" retries). Orders carry paymentProvider, paidAt, paymentExpiresAt.
 *
 * Phase 9 (shop/account.js, customer session unless noted):
 *   POST   /api/shop/me/email                  { email, password } → { email, expiresIn, resendIn, message }
 *                                              (a 6-digit code goes to the NEW address; the account keeps the old one)
 *   POST   /api/shop/me/email/confirm          { code } → profile (with the new email)
 *   GET    /api/shop/me/export                 → the JSON file the API sends (Content-Disposition: attachment)
 *   POST   /api/shop/me/delete                 { password, confirm: "DELETE" } → { message }, and the session cookies are deleted
 *   GET    /api/shop/me/stock-alerts           → { alerts: [{ id, productId, title, thumbnail, variantId, variantLabel, createdAt }] } (waiting alerts only)
 *   DELETE /api/shop/me/stock-alerts/:id       → { ok: true }
 *   POST   /api/shop/products/:id/stock-alerts { email?, variantId? } → 202 { message } (guests too; the same answer every time)
 *   POST   /api/shop/stock-alerts/unsubscribe  { token } → { removed, message } (the email's "stop these alerts" link; no sign-in)
 *   POST   /api/shop/orders/:number/cancel     { reason?, email? } → the cancelled order (customer session, or a guest
 *                                              with the order's email); 422 with the API's text when it is paid or shipped
 * Orders carry `canCancel` (phase 9).
 *
 * Phase 10 (docs/backend/PHASE10_CONTRACT.md):
 *   GET  /api/shop/orders/:number/invoices/:invoice.pdf  → the API's PDF, streamed with its type, size, and
 *                                              file name (customer session)
 *   POST /api/shop/orders/:number/invoices/:invoice.pdf { email } → the same for a guest (the order's email is the proof)
 *   POST /api/shop/orders/:number/paypal/capture { token, email? } → the order (back from PayPal with ?token=…:
 *                                              the API captures the approved payment; customer session or a guest's email)
 *   POST /api/shop/gift-cards/check            { code } → { balance, currency, expiresAt, status } (no sign-in)
 * cart/validate and orders also take `giftCardCode`, gift card lines (`giftCard: { amount, recipientName,
 * recipientEmail, message }`), and `shippingMethod: null` for a cart of gift cards only. Priced carts carry
 * `requiresShipping`, `giftCard: { last4, applied, balance, remaining }`, `giftCardError`, and
 * `totals.giftCard` / `totals.amountDue`; `shippingOptions` lists only the methods offered for this cart.
 *
 * Phase 11 (docs/backend/PHASE11_CONTRACT.md; shop/phase11.js), customer session unless noted:
 *   GET    /api/shop/me/wishlist               → { items: [{ id, product (the API's product card), variant, note, addedAt }], shared }
 *   POST   /api/shop/me/wishlist               { productId, variantId?, note? } → 201 item (200 when it was already there;
 *                                              422 code wishlist_full at 100 items)
 *   PATCH  /api/shop/me/wishlist/:id           { note } → item
 *   DELETE /api/shop/me/wishlist/:id           → { ok: true }
 *   POST   /api/shop/me/wishlist/merge         { items: [{ productId, variantId? }] } → { items, shared, skipped } (once, after signing in)
 *   POST   /api/shop/me/wishlist/share         { regenerate? } → { shared, token (null when already shared), sharedAt }
 *   DELETE /api/shop/me/wishlist/share         → { ok: true } (the link stops working)
 *   GET    /api/shop/wishlists/:token          → { ownerFirstName, items: [{ product, variantLabel, note }] } (no sign-in; 404 when not shared)
 *   GET    /api/shop/me/rewards?page           → { enabled, balance, value, pointValue, transactions, total, page, perPage, lastPage }
 * cart/validate and orders also take `rewardPoints` (signed in). Priced carts carry `crossSells` (product
 * cards), `rewards` ({ balance, maxPoints, minRedeem, pointValue, earnEstimate, … } or null), `rewardPoints`
 * ({ points, amount } applied, or null), `rewardPointsError`, and `totals.rewardPoints`; orders carry
 * `rewardPointsSpent`, `rewardPointsAmount`, `rewardPointsEarned` and `totals.rewardPoints`.
 *
 * Phase 14 (docs/backend/PHASE14_CONTRACT.md; shop/bangladesh.js): a Bangladesh address (country
 * "Bangladesh") also carries divisionId, districtId, areaId (orders, the address book; the API fills city
 * and state and answers the places' names as division/district/area { id, name, nameEn, nameBn }).
 * cart/validate also takes `place: { divisionId, districtId, areaId }` (its delivery zone prices delivery)
 * and `paymentMethod` (cash on delivery's fee and limits). Priced carts carry `deliveryZone: { code, name }`,
 * `cod: { available, reason, message, fee, advance, advanceAmount, … }`, `totals.codFee`, and per delivery
 * method `zone`, `etaDaysMin`, `etaDaysMax`. Orders carry `deliveryZone`, `advancePaid`, `codDue`, `codFee`,
 * `confirmationStatus` (pending | confirmed | unreachable | cancelled) and payment status "partially_paid".
 * The places themselves are public: GET /api/catalog/places/bd/* (catalogApi.js).
 *
 * Phase 20 (docs/backend/PHASE20_CONTRACT.md §3; shop/orderConfirmations.js), no sign-in (the link's token is the proof):
 *   GET  /api/shop/order-confirmations/:token  → { number, total, itemsCount, placedAt, status } (changes nothing)
 *   POST /api/shop/order-confirmations/:token  { action: 'confirm' | 'cancel', reason? } → the same, with the new status
 *                                              (+ `message` when the API sends one). The API's 404 (expired / unknown
 *                                              link), 422 (can't be cancelled any more) and 429 (throttle) go through.
 *
 * Orders carry their documents (phase 3): shipments (carrier, tracking
 * number and link), invoices, and credit memos (refunds).
 */

const isProductId = (value) => /^\d{1,9}$/.test(value ?? '')
const isAddressId = isProductId // the same: a positive whole number
const isOrderNumber = (value) => /^BN-\d{1,12}$/.test(value ?? '')
const isInvoiceNumber = (value) => /^INV-\d{1,12}$/.test(value ?? '')
const isInvoicePdf = (value) => /^INV-\d{1,12}\.pdf$/.test(value ?? '')
const isReturnNumber = (value) => /^RMA-\d{1,12}$/.test(value ?? '')
const isAlertId = isProductId
const isWishlistId = isProductId
const pageOf = (url) => Math.min(Math.max(Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1), 10_000)
// Phase 22: a review's photos are at most 3 × 5 MB; the rest is room for the form's other fields and framing.
const REVIEW_UPLOAD_LIMIT = 16 * 1024 * 1024
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
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelShop.listOrders(cookies[CUSTOMER.access], pageOf(url), request))
  },

  async 'GET orders/:number'({ request, cookies, param }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelShop.getOrder(cookies[CUSTOMER.access], param, request))
  },

  async 'GET orders/:number/invoices/:invoice'({ request, cookies, param, invoice }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelShop.getInvoice(cookies[CUSTOMER.access], param, invoice, request))
  },

  async 'POST products/:id/reviews'({ request, cookies, param }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    // Phase 22: a review with photos is a form upload, handed to the API as it came (never parsed here).
    const contentType = multipartType(request)
    if (contentType) {
      const { bytes, tooLarge } = await readLimitedBody(request, REVIEW_UPLOAD_LIMIT)
      if (tooLarge) {
        const message = serverMessage(request, 'reviewPhotosTooLarge')
        return json({ message, errors: { photos: [message] } }, 422)
      }
      return reply(await laravelShop.submitReviewWithPhotos(cookies[CUSTOMER.access], param, { contentType, bytes }, request), 201)
    }
    return reply(await laravelShop.submitReview(cookies[CUSTOMER.access], param, await readBody(request), request), 201)
  },

  // Phase 8: a new Stripe payment page for an unpaid card order (customer session, or a guest with the order's email).
  async 'POST orders/:number/pay'({ request, cookies, param }) {
    return reply(await laravelShop.payOrder(cookies[CUSTOMER.access], param, await readBody(request), request))
  },

  async 'POST orders/lookup'({ request }) {
    return reply(await laravelShop.lookupOrder(await readBody(request), request))
  },

  // ---- phase 6: address book and returns (the account comes from the session) ----

  async 'GET me/addresses'({ request, cookies }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelCustomer.listAddresses(cookies[CUSTOMER.access], request))
  },

  async 'POST me/addresses'({ request, cookies }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelCustomer.createAddress(cookies[CUSTOMER.access], await readBody(request), request), 201)
  },

  async 'PATCH me/addresses/:id'({ request, cookies, param }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelCustomer.updateAddress(cookies[CUSTOMER.access], param, await readBody(request), request))
  },

  async 'DELETE me/addresses/:id'({ request, cookies, param }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelCustomer.deleteAddress(cookies[CUSTOMER.access], param, request), 200)
  },

  async 'POST orders/:number/returns'({ request, cookies, param }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelCustomer.requestReturn(cookies[CUSTOMER.access], param, await readBody(request), request), 201)
  },

  async 'GET returns'({ request, cookies, url }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelCustomer.listReturns(cookies[CUSTOMER.access], pageOf(url), request))
  },

  async 'GET returns/:number'({ request, cookies, param }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelCustomer.getReturn(cookies[CUSTOMER.access], param, request))
  },

  // ---- phase 7: newsletter (no sign-in) and the saved cart ----

  async 'POST newsletter'({ request }) {
    return reply(await laravelNewsletter.subscribe(await readBody(request), request), 202)
  },

  async 'POST newsletter/confirm'({ request }) {
    return reply(await laravelNewsletter.confirm(await readBody(request), request))
  },

  async 'POST newsletter/unsubscribe'({ request }) {
    return reply(await laravelNewsletter.unsubscribe(await readBody(request), request))
  },

  async 'GET me/cart'({ request, cookies }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelCart.get(cookies[CUSTOMER.access], request))
  },

  async 'POST me/cart/merge'({ request, cookies }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelCart.merge(cookies[CUSTOMER.access], await readBody(request), request))
  },

  // ---- phase 9: self-service (email change, my data, delete my account, stock alerts, cancel) ----

  async 'POST me/email'({ request, cookies }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelAccount.requestEmailChange(cookies[CUSTOMER.access], await readBody(request), request))
  },

  async 'POST me/email/confirm'({ request, cookies }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelAccount.confirmEmailChange(cookies[CUSTOMER.access], await readBody(request), request))
  },

  // The file as the API made it: never parsed or rebuilt here.
  async 'GET me/export'({ request, cookies }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    const result = await laravelAccount.exportData(cookies[CUSTOMER.access], request)
    if (!result.ok) return json(result.body, result.status)
    const { bytes, fileName } = result.data
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  },

  // The account is gone, so is the session: the cookies are deleted with the answer.
  async 'POST me/delete'({ request, cookies }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    const result = await laravelAccount.deleteAccount(cookies[CUSTOMER.access], await readBody(request), request)
    return result.ok ? json(result.data, 200, clearedCookies(CUSTOMER)) : json(result.body, result.status)
  },

  async 'GET me/stock-alerts'({ request, cookies }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelAccount.listStockAlerts(cookies[CUSTOMER.access], request))
  },

  async 'DELETE me/stock-alerts/:id'({ request, cookies, param }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelAccount.deleteStockAlert(cookies[CUSTOMER.access], param, request), 200)
  },

  // Guests too: signed in, the account's email is used (the cookie decides, not the body).
  async 'POST products/:id/stock-alerts'({ request, cookies, param }) {
    return reply(await laravelAccount.createStockAlert(cookies[CUSTOMER.access], param, await readBody(request), request), 202)
  },

  async 'POST stock-alerts/unsubscribe'({ request }) {
    return reply(await laravelAccount.unsubscribeStockAlerts(await readBody(request), request))
  },

  async 'POST orders/:number/cancel'({ request, cookies, param }) {
    return reply(await laravelShop.cancelOrder(cookies[CUSTOMER.access], param, await readBody(request), request))
  },

  // ---- phase 10: invoice PDFs, PayPal, gift cards ----

  async 'GET orders/:number/invoices/:invoice.pdf'({ request, cookies, param, invoice }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return pdfReply(await laravelShop.invoicePdf(cookies[CUSTOMER.access], param, invoice, {}, request))
  },

  // A guest proves the order is theirs with its email (in the body, so it stays out of URLs and logs).
  async 'POST orders/:number/invoices/:invoice.pdf'({ request, cookies, param, invoice }) {
    return pdfReply(await laravelShop.invoicePdf(cookies[CUSTOMER.access], param, invoice, await readBody(request), request))
  },

  async 'POST orders/:number/paypal/capture'({ request, cookies, param }) {
    return reply(await laravelShop.capturePaypal(cookies[CUSTOMER.access], param, await readBody(request), request))
  },

  async 'POST gift-cards/check'({ request }) {
    return reply(await laravelShop.checkGiftCard(await readBody(request), request))
  },

  // ---- phase 11: the account's wishlist (and sharing it), shared wishlists, reward points ----

  async 'GET me/wishlist'({ request, cookies }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelWishlist.list(cookies[CUSTOMER.access], request))
  },

  async 'POST me/wishlist'({ request, cookies }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelWishlist.add(cookies[CUSTOMER.access], await readBody(request), request))
  },

  async 'PATCH me/wishlist/:id'({ request, cookies, param }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelWishlist.update(cookies[CUSTOMER.access], param, await readBody(request), request))
  },

  async 'DELETE me/wishlist/:id'({ request, cookies, param }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelWishlist.remove(cookies[CUSTOMER.access], param, request), 200)
  },

  async 'POST me/wishlist/merge'({ request, cookies }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelWishlist.merge(cookies[CUSTOMER.access], await readBody(request), request))
  },

  async 'POST me/wishlist/share'({ request, cookies }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelWishlist.share(cookies[CUSTOMER.access], await readBody(request), request))
  },

  async 'DELETE me/wishlist/share'({ request, cookies }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelWishlist.stopSharing(cookies[CUSTOMER.access], request), 200)
  },

  // No sign-in: the link's token is the key. Never cached (a link turned off must stop working at once).
  async 'GET wishlists/:token'({ request, param }) {
    return reply(await laravelWishlist.shared(param, request))
  },

  // ---- phase 20: the one-tap confirmation link in the cash on delivery text (/c/:token) ----

  async 'GET order-confirmations/:token'({ request, param }) {
    return reply(await laravelOrderConfirmations.get(param, request))
  },

  async 'POST order-confirmations/:token'({ request, param }) {
    return reply(await laravelOrderConfirmations.respond(param, await readBody(request), request), 200)
  },

  async 'GET me/rewards'({ request, cookies, url }) {
    if (!cookies[CUSTOMER.access]) return notSignedIn(request)
    return reply(await laravelRewards.get(cookies[CUSTOMER.access], pageOf(url), request))
  },
}

/** The API's PDF, passed on as it streams in: never parsed or rebuilt here. */
function pdfReply(result) {
  if (!result.ok) return json(result.body, result.status)
  const { stream, contentLength, fileName } = result.data
  const headers = new Headers({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  if (contentLength && /^\d{1,10}$/.test(contentLength)) headers.set('Content-Length', contentLength)
  return new Response(stream, { status: 200, headers })
}

/** /api/shop/<segments> → a route, or null. */
function matchRoute(method, segments) {
  const path = segments.join('/')
  if (ROUTES[`${method} ${path}`]) return { route: ROUTES[`${method} ${path}`] }
  if (segments.length === 2 && segments[0] === 'orders' && isOrderNumber(segments[1])) {
    return { route: ROUTES[`${method} orders/:number`], param: segments[1] }
  }
  if (segments.length === 3 && segments[0] === 'me' && segments[1] === 'addresses' && isAddressId(segments[2])) {
    return { route: ROUTES[`${method} me/addresses/:id`], param: segments[2] }
  }
  if (segments.length === 3 && segments[0] === 'orders' && isOrderNumber(segments[1]) && ['pay', 'cancel'].includes(segments[2])) {
    return { route: ROUTES[`${method} orders/:number/${segments[2]}`], param: segments[1] }
  }
  if (segments.length === 3 && segments[0] === 'me' && segments[1] === 'wishlist' && isWishlistId(segments[2])) {
    return { route: ROUTES[`${method} me/wishlist/:id`], param: segments[2] }
  }
  if (segments.length === 2 && segments[0] === 'wishlists' && isShareToken(segments[1])) {
    return { route: ROUTES[`${method} wishlists/:token`], param: segments[1] }
  }
  // Any token shape reaches the route, which answers a malformed one with the same plain 404 as an expired one.
  if (segments.length === 2 && segments[0] === 'order-confirmations' && segments[1].length <= 200) {
    return { route: ROUTES[`${method} order-confirmations/:token`], param: segments[1] }
  }
  if (segments.length === 3 && segments[0] === 'me' && segments[1] === 'stock-alerts' && isAlertId(segments[2])) {
    return { route: ROUTES[`${method} me/stock-alerts/:id`], param: segments[2] }
  }
  if (segments.length === 3 && segments[0] === 'products' && isProductId(segments[1]) && segments[2] === 'stock-alerts') {
    return { route: ROUTES[`${method} products/:id/stock-alerts`], param: segments[1] }
  }
  if (segments.length === 3 && segments[0] === 'orders' && isOrderNumber(segments[1]) && segments[2] === 'returns') {
    return { route: ROUTES[`${method} orders/:number/returns`], param: segments[1] }
  }
  if (segments.length === 2 && segments[0] === 'returns' && isReturnNumber(segments[1])) {
    return { route: ROUTES[`${method} returns/:number`], param: segments[1] }
  }
  if (segments.length === 3 && segments[0] === 'products' && isProductId(segments[1]) && segments[2] === 'reviews') {
    return { route: ROUTES[`${method} products/:id/reviews`], param: segments[1] }
  }
  if (segments.length === 4 && segments[0] === 'orders' && isOrderNumber(segments[1]) && segments[2] === 'invoices' && isInvoicePdf(segments[3])) {
    return { route: ROUTES[`${method} orders/:number/invoices/:invoice.pdf`], param: segments[1], invoice: segments[3].slice(0, -4) }
  }
  if (segments.length === 4 && segments[0] === 'orders' && isOrderNumber(segments[1]) && segments[2] === 'paypal' && segments[3] === 'capture') {
    return { route: ROUTES[`${method} orders/:number/paypal/capture`], param: segments[1] }
  }
  if (segments.length === 4 && segments[0] === 'orders' && isOrderNumber(segments[1]) && segments[2] === 'invoices' && isInvoiceNumber(segments[3])) {
    return { route: ROUTES[`${method} orders/:number/invoices/:invoice`], param: segments[1], invoice: segments[3] }
  }
  return null
}

export async function handleShopRequest(request, segments, cookies) {
  const match = matchRoute(request.method, segments)
  if (!match?.route) return json({ message: serverMessage(request, 'notFound') }, 404)
  return match.route({ request, cookies, url: new URL(request.url), param: match.param, invoice: match.invoice })
}
