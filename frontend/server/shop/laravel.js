import { laravel, laravelPdf, pick } from '../http.js'
import { productCards } from './productCard.js'

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
const trimmed = (value, max) => str(value)?.trim().slice(0, max)

/**
 * Phase 10: what the shopper chose for a gift card line (the amount, and who
 * receives it). The amount is a choice, not a price: the API checks it
 * against the product's amounts and limits, and prices the line itself.
 */
export function toGiftCard(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const amount = Number(raw.amount)
  return {
    amount: Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : null,
    recipient_name: trimmed(raw.recipientName, 100) ?? null,
    recipient_email: trimmed(raw.recipientEmail, 254) ?? null,
    message: trimmed(raw.message, 500) || null,
  }
}

// variant_id (phase 5) only when the line names one: lines without it are sent as before.
// gift_card (phase 10) only on gift card lines.
const toItems = (items) =>
  (Array.isArray(items) ? items.slice(0, 50) : []).map((item) => {
    const variantId = toQuantity(item?.variantId)
    const giftCard = toGiftCard(item?.giftCard)
    return {
      product_id: toQuantity(item?.productId),
      ...(Number.isInteger(variantId) && variantId > 0 && { variant_id: variantId }),
      quantity: toQuantity(item?.quantity),
      ...(giftCard && { gift_card: giftCard }),
    }
  })

/** Phase 10: a gift card code typed at checkout (letters, digits, dashes, spaces), or undefined. */
const toGiftCardCode = (value) => {
  const code = str(value)?.trim().toUpperCase().slice(0, 40)
  return code && /^[A-Z0-9 -]{4,40}$/.test(code) ? code : undefined
}

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
  // Phase 6: what the customer group's discount took off (already inside the subtotal).
  ...(raw.group_discount !== undefined && { groupDiscount: money(raw.group_discount) ?? 0 }),
  // Phase 10: what a gift card pays of the total, and what is left to pay by another method.
  ...(raw.gift_card !== undefined && raw.gift_card !== null && { giftCard: money(raw.gift_card) ?? 0 }),
  ...(raw.amount_due !== undefined && raw.amount_due !== null && { amountDue: money(raw.amount_due) ?? 0 }),
  // Phase 11: what reward points pay of the total (after tax, before a gift card).
  ...(raw.reward_points !== undefined && raw.reward_points !== null && { rewardPoints: money(raw.reward_points) ?? 0 }),
})

const wholePoints = (value) => (Number.isInteger(value) ? value : Number.parseInt(value, 10) || 0)

/**
 * Phase 11: the signed-in customer's reward points on this cart (null for
 * guests, or when the store has points off): balance, the most usable here,
 * what this order would earn, and what is applied.
 */
export const fromCartRewards = (raw) =>
  raw && typeof raw === 'object' && raw.enabled !== false
    ? {
        enabled: true,
        balance: wholePoints(raw.balance),
        pointValue: money(raw.point_value) ?? 0,
        minRedeem: wholePoints(raw.min_redeem),
        maxPoints: wholePoints(raw.max_points),
        earnEstimate: wholePoints(raw.earn_estimate),
        appliedPoints: wholePoints(raw.applied_points),
        appliedAmount: money(raw.applied_amount) ?? 0,
      }
    : null

/** Phase 11: an order's reward points (spent, what they paid, earned once paid), as top-level fields. */
function fromOrderRewards(raw) {
  if (!raw || typeof raw !== 'object') return {}
  return {
    rewardPointsSpent: wholePoints(raw.spent),
    rewardPointsAmount: money(raw.amount) ?? 0,
    rewardPointsEarned: raw.earned === null || raw.earned === undefined ? null : wholePoints(raw.earned),
  }
}

/** Phase 11: reward points to spend (a whole number ≥ 0), or undefined. */
const toRewardPoints = (value) => {
  const points = toQuantity(value)
  return Number.isInteger(points) && points > 0 ? Math.min(points, 100_000_000) : undefined
}

/** Phase 10: a gift card line's recipient and message (never the card's code: it's emailed to the recipient). */
const fromGiftCardLine = (raw) =>
  raw && typeof raw === 'object'
    ? {
        amount: money(raw.amount),
        recipientName: str(raw.recipient_name) ?? '',
        recipientEmail: str(raw.recipient_email) ?? '',
        message: str(raw.message) ?? null,
      }
    : null

/** Phase 10: the gift card applied at checkout: its last 4 characters, what it pays, and what stays on it. */
export const fromAppliedGiftCard = (raw) =>
  raw && typeof raw === 'object'
    ? {
        last4: str(raw.last4) ?? str(raw.code_last4) ?? null,
        applied: money(raw.applied ?? raw.amount) ?? 0,
        balance: money(raw.balance) ?? null,
        remaining: money(raw.balance_after) ?? null,
        expiresAt: str(raw.expires_at) ?? null,
      }
    : null

/** Phase 6: the shopper's customer group as the API names it ({ name, discount_percent }), or null. */
export const fromGroup = (raw) =>
  raw && typeof raw === 'object' && typeof raw.name === 'string' ? { name: raw.name, discountPercent: Number(raw.discount_percent ?? 0) || 0 } : null

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
  // Phase 6: a customer group's discount on the line. salePrice already includes it;
  // baseSalePrice is the product's own sale price before it.
  ...(Number(raw.group_discount_percent) > 0 && { groupDiscountPercent: Number(raw.group_discount_percent), baseSalePrice: money(raw.base_sale_price) }),
  // Phase 7: the catalog price rule that set the price ("VIP price", "Black Friday"),
  // and the line's share of the cart rules' discount. Older lines have neither.
  ...(typeof raw.price_label === 'string' && raw.price_label.trim() && { priceLabel: raw.price_label.trim().slice(0, 120) }),
  ...(raw.discount !== undefined && raw.discount !== null && { discount: money(raw.discount) ?? 0 }),
  // Phase 10: gift card lines carry the recipient they go to (and need no shipping).
  ...(raw.gift_card && typeof raw.gift_card === 'object' && { giftCard: fromGiftCardLine(raw.gift_card) }),
  ...(raw.type === 'gift_card' && { productType: 'gift_card' }),
})

/** Phase 7: a cart price rule that applied (a typed code, or an automatic rule). */
export const fromAppliedRule = (raw = {}) => ({
  id: raw.id ?? null,
  code: str(raw.code) ?? null,
  label: str(raw.label) ?? str(raw.code) ?? 'Discount',
  automatic: raw.automatic === true,
  discount: money(raw.discount) ?? 0,
  freeShipping: raw.free_shipping === true,
})
const fromAppliedRules = (raw) => (Array.isArray(raw) ? raw.slice(0, 20).map(fromAppliedRule) : [])

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
    // Phase 7: every cart rule that applied, automatic ones first (each with its label and saving).
    appliedRules: fromAppliedRules(raw.applied_rules),
    // Phase 10: only the methods offered for this cart (table rates by country, weight, and subtotal), each with its price.
    shippingOptions: (raw.shipping_options ?? []).filter((option) => option && option.available !== false).map((option) => ({ id: option.id, label: option.label, eta: option.eta, price: money(option.price) })),
    // Phase 10: a cart of gift cards only needs no delivery.
    requiresShipping: raw.shipping_required !== false,
    // Why no delivery method is offered (e.g. no table rate for that country or weight), or null.
    shippingError: str(raw.shipping_error) ?? null,
    giftCard: fromAppliedGiftCard(raw.gift_card),
    giftCardError: str(raw.gift_card_error) ?? null,
    // Phase 4 tax: false when no country was given, so the tax shown is not final (0).
    totals: fromTotals(raw.totals),
    taxEstimated: (raw.tax_estimated ?? raw.totals?.tax_estimated) === true,
    // Phase 6: the group the cart was priced for (General for guests).
    customerGroup: fromGroup(raw.customer_group),
    // Phase 11: "Customers also bought" (product cards, the catalog's shape), and reward points.
    crossSells: productCards(raw.cross_sells, 4),
    rewards: fromCartRewards(raw.rewards),
    rewardPoints: rewardPointsApplied(raw.rewards),
    rewardPointsError: str(raw.reward_points_error) ?? null,
  }
}

/** { points, amount } of the reward points applied to the cart, or null. */
function rewardPointsApplied(raw) {
  const rewards = fromCartRewards(raw)
  return rewards && rewards.appliedPoints > 0 ? { points: rewards.appliedPoints, amount: rewards.appliedAmount } : null
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
// Phase 12: a 3-letter currency code (an order's, an invoice's), or nothing.
export const currencyCode = (value) => (typeof value === 'string' && /^[A-Za-z]{3}$/.test(value.trim()) ? value.trim().toUpperCase() : undefined)
const withCurrency = (raw) => (currencyCode(raw?.currency) ? { currency: currencyCode(raw.currency) } : {})

export const fromInvoiceSummary = (raw) => ({ number: raw.number, amount: money(raw.amount), createdAt: raw.created_at, ...withCurrency(raw) })
export const fromCreditMemoSummary = (raw) => ({ number: raw.number, total: money(raw.total), createdAt: raw.created_at, ...withCurrency(raw) })

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
    // Phase 12: the order's currency (the invoice's own, else its order's).
    ...withCurrency(raw.currency ? raw : raw.order),
  }
}

/**
 * Phase 6: whether the customer may return items of this order, and which
 * (the API's `return_eligibility`). Only orders the customer opens with their
 * session carry it.
 */
export const fromReturnEligibility = (raw) =>
  raw && typeof raw === 'object'
    ? {
        eligible: raw.eligible === true,
        code: typeof raw.code === 'string' ? raw.code : null,
        message: str(raw.message) ?? null,
        deadline: str(raw.deadline) ?? null,
        windowDays: Number.isInteger(raw.window_days) ? raw.window_days : null,
        reasons: (Array.isArray(raw.reasons) ? raw.reasons : []).filter((reason) => typeof reason === 'string'),
        items: (Array.isArray(raw.items) ? raw.items : []).map((item) => ({
          orderItemId: item.order_item_id,
          title: str(item.name) ?? '',
          variantLabel: str(item.variant_label) ?? null,
          sku: item.sku ?? null,
          thumbnail: item.thumbnail_url ?? null,
          ordered: item.ordered ?? 0,
          returnable: Number.isInteger(item.returnable) ? item.returnable : 0,
        })),
      }
    : null

/**
 * Phase 8: the order's card payment through Stripe, as the API's `payment`
 * summary gives it on every order ({ provider, paid_at, url, expires_at,
 * can_pay }, plus `error` when a payment page couldn't be opened). `url` is
 * Stripe's payment page: only https addresses get through, since the browser
 * navigates to it. Staff-only keys (reference, dashboard link) never reach
 * the storefront.
 */
export const fromPayment = (raw) =>
  raw && typeof raw === 'object'
    ? {
        provider: str(raw.provider) ?? null,
        url: httpsUrl(raw.url),
        expiresAt: str(raw.expires_at) ?? null,
        paidAt: str(raw.paid_at) ?? null,
        canPay: raw.can_pay === true,
        ...(str(raw.error) && { error: raw.error.slice(0, 300) }),
        // Phase 12, SSLCommerz: how it was paid ("BKASH-BKash", "VISA-Dutch Bangla"), for "Paid with bKash".
        ...(str(raw.card_type) && { cardType: raw.card_type.slice(0, 60) }),
        ...(str(raw.method_label) && { methodLabel: raw.method_label.slice(0, 60) }),
      }
    : null

/** Phase 8: the payment's top-level fields on the storefront's order (provider, paid at, Pay now). */
function fromOrderPayment(raw) {
  const payment = fromPayment(raw.payment)
  if (!payment) return {}
  return { paymentProvider: payment.provider, paidAt: payment.paidAt, paymentExpiresAt: payment.expiresAt, canPay: payment.canPay, payment }
}

const fromReturnSummary = (raw) => ({ number: raw.number, status: raw.status, createdAt: raw.created_at ?? null })

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
    shippingMethod: raw.shipping_method && typeof raw.shipping_method === 'object' && raw.shipping_method.id !== 'none' ? pick(raw.shipping_method, ['id', 'label', 'eta']) : null,
    email: raw.email,
    phone: raw.phone,
    shippingAddress: fromAddress(raw.shipping_address),
    billingAddress: fromAddress(raw.billing_address ?? raw.shipping_address),
    couponCode: raw.coupon_code ?? null,
    appliedRules: fromAppliedRules(raw.applied_rules),
    items: (raw.items ?? []).map(fromLine),
    totals: fromTotals(raw.totals),
    placedAt: raw.placed_at,
    // Phase 12: what the order was charged in (orders before phase 12 are USD); its money is written in it.
    ...withCurrency(raw),
    ...(raw.history && { history: raw.history.map(fromHistory) }),
    // Phase 3 documents; older answers have none.
    shipments: (raw.shipments ?? []).map(fromShipment),
    invoices: (raw.invoices ?? []).map(fromInvoiceSummary),
    creditMemos: (raw.credit_memos ?? []).map(fromCreditMemoSummary),
    // Phase 6: the price group at the time of the order, returns asked for, and what can still be returned.
    ...(typeof raw.customer_group === 'string' && { customerGroup: raw.customer_group }),
    ...(Array.isArray(raw.returns) && { returns: raw.returns.map(fromReturnSummary) }),
    ...(raw.return_eligibility && { returnEligibility: fromReturnEligibility(raw.return_eligibility) }),
    // Phase 8: the card payment (Stripe): provider, paid at, whether Pay now works, the payment page.
    ...fromOrderPayment(raw),
    // Phase 9: whether the shopper may cancel it themselves (unpaid, nothing invoiced or shipped).
    ...(typeof raw.can_cancel === 'boolean' && { canCancel: raw.can_cancel }),
    // Phase 10: the gift card that paid (part of) it, and whether it ships at all.
    ...(raw.gift_card && typeof raw.gift_card === 'object' && { giftCard: fromAppliedGiftCard(raw.gift_card) }),
    // A gift-card-only order is stored with shipping method "none" ("No shipping needed").
    ...((raw.shipping_required === false || raw.shipping_method?.id === 'none') && { requiresShipping: false }),
    // Phase 11: reward points spent on it (and what they paid), and earned once it was paid.
    ...fromOrderRewards(raw.reward_points),
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
    const giftCardCode = toGiftCardCode(body.giftCardCode)
    const rewardPoints = token ? toRewardPoints(body.rewardPoints) : undefined
    const payload = {
      items: toItems(body.items),
      coupon_code: str(body.couponCode) || null,
      // null: a cart of gift cards only (no delivery).
      shipping_method: body.shippingMethod === null ? null : (str(body.shippingMethod) ?? 'standard'),
      ...(email && { email }),
      ...(country && { country }),
      ...(giftCardCode && { gift_card_code: giftCardCode }),
      // Phase 11: reward points to spend (signed in only: a guest has none).
      ...(rewardPoints && { reward_points: rewardPoints }),
    }
    let result = await laravel('/api/v1/cart/validate', { method: 'POST', token, request, body: payload })
    // An expired session shouldn't stop the cart from being priced: ask again as a guest (without points).
    if (result.status === 401 && token) {
      const guestPayload = { ...payload }
      delete guestPayload.reward_points
      result = await laravel('/api/v1/cart/validate', { method: 'POST', request, body: guestPayload })
    }
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
        shipping_method: body.shippingMethod === null ? null : str(body.shippingMethod),
        payment_method: str(body.paymentMethod),
        // Phase 10: one gift card per order; "gift_card" as the payment method when it pays everything.
        ...(toGiftCardCode(body.giftCardCode) && { gift_card_code: toGiftCardCode(body.giftCardCode) }),
        // Phase 11: reward points (signed-in customers; points pay before a gift card). "reward_points" as the
        // payment method when they (alone) pay everything.
        ...(token && toRewardPoints(body.rewardPoints) && { reward_points: toRewardPoints(body.rewardPoints) }),
        email: str(body.email),
        phone: str(body.phone),
        shipping_address: toAddress(body.shippingAddress),
        billing_address: toAddress(body.billingAddress),
        expected_total: typeof body.expectedTotal === 'number' ? body.expectedTotal.toFixed(2) : undefined,
        // Phase 6: signed-in customers can keep the shipping address in their address book.
        ...(token && body.saveAddress === true && { save_address: true }),
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

  /**
   * Phase 8: a new payment page for an unpaid card order. The customer's
   * token proves the order is theirs; a guest proves it with the order's
   * email (the same proof as the order lookup). 422 when it can't be paid.
   */
  async payOrder(token, number, body, request) {
    const email = str(body.email)?.trim().slice(0, 254)
    const result = await laravel(`/api/v1/orders/${encodeURIComponent(number)}/pay`, { method: 'POST', token, request, body: email ? { email } : {} })
    // The answer is the order with its new payment page: only the payment goes to the browser.
    return answer(result, [200, 201], (data) => fromPayment(data.data?.payment) ?? { provider: null, url: null, expiresAt: null, paidAt: null, canPay: false })
  },

  /**
   * Phase 9: the shopper cancels their own order. The customer's token proves
   * it is theirs; a guest proves it with the order's email (like the lookup).
   * The API refuses (422, "Contact us to cancel") once it is paid, invoiced,
   * or shipped. → the cancelled order.
   */
  async cancelOrder(token, number, body, request) {
    const email = token ? undefined : str(body.email)?.trim().slice(0, 254)
    const reason = str(body.reason)?.trim().slice(0, 500)
    const result = await laravel(`/api/v1/orders/${encodeURIComponent(number)}/cancel`, {
      method: 'POST',
      token,
      request,
      body: { ...(email && { email }), ...(reason && { reason }) },
    })
    return answer(result, [200], (data) => fromOrder(data.data))
  },

  /**
   * Phase 10: back from PayPal with ?token=…, the API captures the approved
   * payment server-side (status, amount, and currency checked) and answers
   * with the order. The customer's token, or a guest's order email, proves
   * the order is theirs. → the order (paid, or still waiting).
   */
  async capturePaypal(token, number, body, request) {
    const paypalToken = str(body.token)?.trim()
    if (!paypalToken || !/^[A-Za-z0-9_-]{6,64}$/.test(paypalToken)) {
      const message = "This payment link isn't valid. Open your order and use Pay now."
      return { ok: false, status: 422, body: { message, errors: { token: [message] } } }
    }
    const email = token ? undefined : str(body.email)?.trim().slice(0, 254)
    const result = await laravel(`/api/v1/orders/${encodeURIComponent(number)}/paypal/capture`, {
      method: 'POST',
      token,
      request,
      body: { token: paypalToken, ...(email && { email }) },
    })
    return answer(result, [200, 201], (data) => fromOrder(data.data))
  },

  /**
   * Phase 10: an invoice as a PDF file (the customer's token, or a guest's
   * order email). → { ok: true, stream, … } with the API's own headers, or a failure.
   */
  async invoicePdf(token, number, invoice, body, request) {
    const email = token ? undefined : str(body?.email)?.trim().slice(0, 254)
    if (!token && !email) return { ok: false, status: 401, body: { message: 'Please sign in to continue.' } }
    // The guest's email goes in a header, not the address, so it stays out of the API's request logs.
    const result = await laravelPdf(`/api/v1/orders/${encodeURIComponent(number)}/invoices/${encodeURIComponent(invoice)}.pdf`, {
      token,
      request,
      headers: email ? { 'X-Order-Email': email } : {},
    })
    if (!result.stream) return failed(result)
    return { ok: true, status: 200, data: { ...result, fileName: pdfFileName(result.disposition, invoice) } }
  },

  /** Phase 10: a gift card's balance. The API gives the same 422 for unknown and disabled codes. */
  async checkGiftCard(body, request) {
    const code = toGiftCardCode(body.code)
    if (!code) {
      const message = 'Enter the gift card code from your email.'
      return { ok: false, status: 422, body: { message, errors: { code: [message] } } }
    }
    const result = await laravel('/api/v1/gift-cards/check', { method: 'POST', request, body: { code } })
    return answer(result, [200], (data) => fromGiftCardBalance(data.data ?? data))
  },

  async lookupOrder(body, request) {
    const result = await laravel('/api/v1/orders/lookup', { method: 'POST', request, body: { number: str(body.number)?.trim(), email: str(body.email)?.trim() } })
    return answer(result, [200], (data) => fromOrder(data.data))
  },
}

/** "INV-100001.pdf" from the API's Content-Disposition, or the invoice number (only safe file names get through). */
export function pdfFileName(disposition, invoice) {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? '')
  const name = match ? decodeURIComponent(match[1]).trim() : ''
  return /^[\w.-]{1,100}\.pdf$/i.test(name) ? name : `${invoice}.pdf`
}

/** POST /gift-cards/check → { balance, currency, expiresAt, status } (no code, no history). */
export const fromGiftCardBalance = (raw = {}) => ({
  balance: money(raw.balance) ?? 0,
  currency: str(raw.currency) ?? 'USD',
  expiresAt: str(raw.expires_at) ?? null,
  status: ['active', 'disabled', 'expired'].includes(raw.status) ? raw.status : 'active',
})
