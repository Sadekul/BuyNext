import { laravel, pick } from '../http.js'

/*
 * Shopping with BuyNest's Laravel API (docs/backend/PHASE2_CONTRACT.md):
 * cart pricing, orders, and the guest order lookup.
 *
 * The API speaks snake_case with money as decimal strings ("21.08"); the
 * storefront gets camelCase with money as numbers, the same shapes its demo
 * orders use. Only listed fields are copied in either direction, so the
 * browser can't send prices (the server prices everything) and never sees
 * more than it needs.
 *
 * Every function resolves to { ok: true, status, data } or
 * { ok: false, status, body } (body is safe to send to the browser).
 */

const money = (value) => (value === null || value === undefined ? null : Number(value))
const str = (value) => (typeof value === 'string' ? value : undefined)
const camelKey = (key) => key.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase())
/** "shipping_address.postal_code" → "shippingAddress.postalCode" (form field paths). */
export const camelPath = (field) => field.split('.').map(camelKey).join('.')

// ---- browser → API ----

const toQuantity = (value) => (Number.isInteger(value) ? value : Number.parseInt(value, 10))
// variant_id (phase 5) only when the line names one: lines without it are sent as before.
const toItems = (items) =>
  (Array.isArray(items) ? items.slice(0, 50) : []).map((item) => {
    const variantId = toQuantity(item?.variantId)
    return { product_id: toQuantity(item?.productId), ...(Number.isInteger(variantId) && variantId > 0 && { variant_id: variantId }), quantity: toQuantity(item?.quantity) }
  })

const toAddress = (address) =>
  address && typeof address === 'object'
    ? {
        first_name: str(address.firstName),
        last_name: str(address.lastName),
        line1: str(address.line1),
        line2: str(address.line2) || null,
        city: str(address.city),
        state: str(address.state),
        postal_code: str(address.postalCode),
        country: str(address.country),
      }
    : null

// ---- API → browser ----

export const fromAddress = (raw) =>
  raw && {
    firstName: raw.first_name ?? '',
    lastName: raw.last_name ?? '',
    line1: raw.line1 ?? '',
    line2: raw.line2 ?? '',
    city: raw.city ?? '',
    state: raw.state ?? '',
    postalCode: raw.postal_code ?? '',
    country: raw.country ?? '',
  }

export const fromTotals = (raw = {}) => ({
  itemCount: raw.item_count ?? 0,
  subtotal: money(raw.subtotal) ?? 0,
  discount: money(raw.discount) ?? 0,
  shipping: money(raw.shipping) ?? 0,
  tax: money(raw.tax) ?? 0,
  total: money(raw.total) ?? 0,
  // Orders (phase 3): what was paid (invoices) and refunded (credit memos). Carts have neither.
  ...(raw.paid !== undefined && { paid: money(raw.paid) ?? 0 }),
  ...(raw.refunded !== undefined && { refunded: money(raw.refunded) ?? 0 }),
})

/** A cart or order line: the storefront's item shape (title, thumbnail) plus the server's prices. */
export const fromLine = (raw) => ({
  productId: raw.product_id ?? null,
  sku: raw.sku ?? null,
  title: raw.name,
  thumbnail: raw.thumbnail_url ?? null,
  price: money(raw.price),
  discountPercentage: Number(raw.discount_percent ?? 0),
  salePrice: money(raw.sale_price),
  quantity: raw.quantity,
  lineTotal: money(raw.line_total),
  // Phase 5: the variant bought ("Size: M / Color: Red"); lines without one keep their old shape.
  ...(Number.isInteger(raw.variant_id) && { variantId: raw.variant_id, variantLabel: str(raw.variant_label) ?? null }),
})

const fromProblem = (raw) => ({
  productId: raw.product_id ?? null,
  ...(Number.isInteger(raw.variant_id) && { variantId: raw.variant_id }),
  code: raw.code,
  message: raw.message,
})

/** cart/validate data → the checkout's priced cart. */
export function fromCart(raw = {}) {
  return {
    lines: (raw.lines ?? []).map((line) => ({
      ...fromLine(line),
      stock: line.stock_quantity ?? null,
      minimumOrderQuantity: line.min_order_quantity ?? 1,
      available: line.available === true,
    })),
    problems: (raw.problems ?? []).map(fromProblem),
    coupon: raw.coupon ? pick(raw.coupon, ['code', 'description']) : null,
    couponError: raw.coupon_error ?? null,
    shippingOptions: (raw.shipping_options ?? []).map((option) => ({ id: option.id, label: option.label, eta: option.eta, price: money(option.price) })),
    // Phase 4 tax: false when no country was given, so the tax shown is not final (0).
    totals: fromTotals(raw.totals),
    taxEstimated: (raw.tax_estimated ?? raw.totals?.tax_estimated) === true,
  }
}

// Tracking links become <a href>: only https addresses get through (never javascript: or http:).
const httpsUrl = (value) => (typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value) ? value : null)

/** ShipmentResource → a shipment, as customers see it. */
export const fromShipment = (raw) => ({
  number: raw.number,
  carrier: raw.carrier,
  carrierLabel: raw.carrier_label ?? raw.carrier,
  trackingNumber: raw.tracking_number ?? null,
  trackingUrl: httpsUrl(raw.tracking_url),
  createdAt: raw.created_at,
})
export const fromInvoiceSummary = (raw) => ({ number: raw.number, amount: money(raw.amount), createdAt: raw.created_at })
export const fromCreditMemoSummary = (raw) => ({ number: raw.number, total: money(raw.total), createdAt: raw.created_at })

/** InvoiceResource → the printable invoice (customers: no admin name or internal note). */
export function fromInvoice(raw) {
  return {
    number: raw.number,
    orderNumber: raw.order_number,
    amount: money(raw.amount),
    createdAt: raw.created_at,
    billingAddress: fromAddress(raw.billing_address),
    items: (raw.items ?? []).map(fromLine),
    totals: fromTotals(raw.totals),
  }
}

const fromHistory = (raw) => ({
  status: raw.status,
  paymentStatus: raw.payment_status ?? null,
  note: raw.note ?? null,
  createdAt: raw.created_at,
})

/** OrderResource → the storefront's order. */
export function fromOrder(raw) {
  return {
    number: raw.number,
    status: raw.status,
    paymentStatus: raw.payment_status,
    paymentMethod: raw.payment_method,
    shippingMethod: raw.shipping_method ? pick(raw.shipping_method, ['id', 'label', 'eta']) : null,
    email: raw.email,
    phone: raw.phone,
    shippingAddress: fromAddress(raw.shipping_address),
    billingAddress: fromAddress(raw.billing_address ?? raw.shipping_address),
    couponCode: raw.coupon_code ?? null,
    items: (raw.items ?? []).map(fromLine),
    totals: fromTotals(raw.totals),
    placedAt: raw.placed_at,
    ...(raw.history && { history: raw.history.map(fromHistory) }),
    // Phase 3 documents; older answers have none.
    shipments: (raw.shipments ?? []).map(fromShipment),
    invoices: (raw.invoices ?? []).map(fromInvoiceSummary),
    creditMemos: (raw.credit_memos ?? []).map(fromCreditMemoSummary),
  }
}

/**
 * A failed answer, with only safe keys. Field names in 422 errors become the
 * storefront's ("shipping_address.postal_code" → "shippingAddress.postalCode").
 * 409 "prices changed" carries the freshly priced cart.
 */
export function failed({ status, data }) {
  const body = { message: data?.message ?? 'The request failed.' }
  if (data?.errors && typeof data.errors === 'object') {
    body.errors = Object.fromEntries(Object.entries(data.errors).map(([field, messages]) => [camelPath(field), messages]))
  }
  if (Array.isArray(data?.problems)) body.problems = data.problems.map(fromProblem)
  // A reason the store explains its own way (e.g. 403 guest_checkout_disabled).
  if (typeof data?.code === 'string' && /^[a-z_]{1,60}$/.test(data.code)) body.code = data.code
  if (status === 409 && data?.data) {
    body.code = 'prices_changed'
    body.cart = fromCart(data.data)
  }
  return { ok: false, status, body }
}

/** ReviewResource → the review the storefront shows (no customer id or email). */
export const fromReview = (raw = {}) => ({
  id: raw.id ?? null,
  rating: raw.rating,
  title: str(raw.title) ?? null,
  comment: str(raw.comment) ?? '',
  date: raw.created_at ?? null,
  reviewerName: str(raw.author_name) ?? null,
  verifiedPurchase: raw.verified_purchase === true,
  status: ['pending', 'approved', 'rejected'].includes(raw.status) ? raw.status : 'pending',
})

const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : failed(result))

export const laravelShop = {
  /**
   * { items: [{ productId, quantity }], couponCode, shippingMethod, email?, country? } → priced cart (with taxEstimated).
   * The customer's token (when signed in) or a guest's email lets the API
   * check per-customer coupon limits before checkout.
   */
  async validateCart(body, token, request) {
    const email = str(body.email)?.trim().slice(0, 254)
    // The shipping country prices tax (phase 4); without it the API leaves tax at 0.
    const country = str(body.country)?.trim().slice(0, 60)
    const payload = {
      items: toItems(body.items),
      coupon_code: str(body.couponCode) || null,
      shipping_method: str(body.shippingMethod) ?? 'standard',
      ...(email && { email }),
      ...(country && { country }),
    }
    let result = await laravel('/api/v1/cart/validate', { method: 'POST', token, request, body: payload })
    // An expired session shouldn't stop the cart from being priced: ask again as a guest.
    if (result.status === 401 && token) result = await laravel('/api/v1/cart/validate', { method: 'POST', request, body: payload })
    return answer(result, [200], (data) => fromCart(data.data))
  },

  /** Places an order as a guest, or as the customer whose token is given. Prices never come from the browser. */
  async placeOrder(body, token, request) {
    const result = await laravel('/api/v1/orders', {
      method: 'POST',
      token,
      request,
      body: {
        items: toItems(body.items),
        coupon_code: str(body.couponCode) || null,
        shipping_method: str(body.shippingMethod),
        payment_method: str(body.paymentMethod),
        email: str(body.email),
        phone: str(body.phone),
        shipping_address: toAddress(body.shippingAddress),
        billing_address: toAddress(body.billingAddress),
        expected_total: typeof body.expectedTotal === 'number' ? body.expectedTotal.toFixed(2) : undefined,
      },
    })
    return answer(result, [200, 201], (data) => fromOrder(data.data))
  },

  async listOrders(token, page, request) {
    const result = await laravel(`/api/v1/orders?page=${page}`, { token, request })
    return answer(result, [200], (data) => ({
      orders: data.data.map(fromOrder),
      total: data.meta?.total ?? data.data.length,
      page: data.meta?.current_page ?? page,
      perPage: data.meta?.per_page ?? data.data.length,
      lastPage: data.meta?.last_page ?? 1,
    }))
  },

  async getOrder(token, number, request) {
    const result = await laravel(`/api/v1/orders/${encodeURIComponent(number)}`, { token, request })
    return answer(result, [200], (data) => fromOrder(data.data))
  },

  /** One invoice of the customer's own order (someone else's → 404). */
  async getInvoice(token, number, invoice, request) {
    const result = await laravel(`/api/v1/orders/${encodeURIComponent(number)}/invoices/${encodeURIComponent(invoice)}`, { token, request })
    return answer(result, [200], (data) => fromInvoice(data.data))
  },

  /**
   * A signed-in customer's review of a product (phase 5). Only the three
   * fields go through; the API strips HTML, checks one review per customer
   * (422 already_reviewed), and rate-limits.
   */
  async submitReview(token, productId, body, request) {
    const rating = toQuantity(body.rating)
    const title = str(body.title)?.trim().slice(0, 200)
    const comment = str(body.comment)?.trim().slice(0, 4000)
    const result = await laravel(`/api/v1/products/${productId}/reviews`, {
      method: 'POST',
      token,
      request,
      body: { rating: Number.isInteger(rating) ? rating : null, title: title || null, comment: comment ?? '' },
    })
    return answer(result, [200, 201], (data) => fromReview(data.data))
  },

  async lookupOrder(body, request) {
    const result = await laravel('/api/v1/orders/lookup', { method: 'POST', request, body: { number: str(body.number)?.trim(), email: str(body.email)?.trim() } })
    return answer(result, [200], (data) => fromOrder(data.data))
  },
}
