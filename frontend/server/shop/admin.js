import { laravel } from '../http.js'
import { camelPath, fromAddress, fromLine, fromOrder, fromShipment, fromTotals } from './laravel.js'
import { productParts } from './adminCatalog.js'
// Phase 7 (system): the dashboard's new blocks.
import { dashboardBlocks } from './adminContent.js'
// Phase 10: gift cards on the order page.
import { issuedGiftCards, lineGiftCard, orderGiftCardPayment } from './adminPhase10.js'

/*
 * The admin dashboard's products, orders, and overview from BuyNest's Laravel
 * admin API (/api/admin/v1, admin token). Answers are mapped to the shapes
 * the admin app already uses for the DummyJSON demo data, plus the fields
 * only real data has (product status, order status, payment, history).
 * Every answer says `live: true`, so the app drops its "demo data" notices.
 *
 * Each function resolves to { ok: true, status, data } or { ok: false, status, body }.
 */

const money = (value) => (value === null || value === undefined ? null : Number(value))
const AVAILABILITY = { in_stock: 'In Stock', low_stock: 'Low Stock', out_of_stock: 'Out of Stock' }
// Admin form field ↔ API field.
const PRODUCT_FIELDS = {
  title: 'name',
  brand: 'brand',
  category: 'category',
  description: 'description',
  price: 'price',
  discountPercentage: 'discount_percent',
  stock: 'stock_quantity',
  status: 'status',
  // Phase 7 (system): SEO.
  metaTitle: 'meta_title',
  metaDescription: 'meta_description',
  // Phase 10 §4 and §5: weight in grams; gift card products and their amounts.
  weight: 'weight',
  type: 'type',
  giftCardAmounts: 'gift_card_amounts',
  giftCardMinAmount: 'gift_card_min_amount',
  giftCardMaxAmount: 'gift_card_max_amount',
}
const FORM_FIELD = Object.fromEntries(Object.entries(PRODUCT_FIELDS).map(([form, api]) => [api, form]))
const ORDER_FIELDS = { payment_status: 'paymentStatus', notify_customer: 'notifyCustomer', return_number: 'returnNumber' }
// The admin's sort names → the API's.
const PRODUCT_SORT = { title: 'name', price: 'price', stock: 'stock', rating: 'rating', newest: 'newest' }

function failed({ status, data }, fieldNames = {}) {
  const body = { message: data?.message ?? 'The request failed.' }
  if (data?.errors && typeof data.errors === 'object') {
    body.errors = Object.fromEntries(Object.entries(data.errors).map(([field, messages]) => [fieldNames[field] ?? camelPath(field), messages]))
  }
  // 403 permission_denied (phase 4): the admin app names the permission the role lacks.
  if (typeof data?.code === 'string') body.code = data.code
  if (typeof data?.permission === 'string') body.permission = data.permission
  return { ok: false, status, body }
}
const answer = (result, okStatuses, map, fieldNames) =>
  okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : failed(result, fieldNames)

/** AdminProductResource → the admin's product. */
export function adminProduct(raw) {
  return {
    id: raw.id,
    title: raw.name,
    category: raw.category?.slug ?? null,
    brand: raw.brand?.name ?? null,
    price: money(raw.price),
    discountPercentage: Number(raw.discount_percent ?? 0),
    stock: raw.stock_quantity ?? 0,
    rating: money(raw.rating_average),
    thumbnail: raw.thumbnail_url ?? raw.images?.[0]?.url ?? null,
    availabilityStatus: AVAILABILITY[raw.availability] ?? null,
    status: raw.status ?? 'active',
    sku: raw.sku ?? null,
    description: raw.description ?? '',
    minimumOrderQuantity: raw.min_order_quantity ?? 1,
    images: (raw.images ?? []).map((image) => image.url),
    tags: raw.tags ?? [],
    // Phase 7 (system): SEO (empty = the store falls back to the name and description).
    metaTitle: raw.meta_title ?? '',
    metaDescription: raw.meta_description ?? '',
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
    // Phase 5: images with their ids and alt text, options, and variants.
    ...productParts(raw),
    // Phase 9: shoppers waiting for a back-in-stock email (product detail only).
    ...(Number.isInteger(raw.stock_alerts_waiting) && { stockAlertsWaiting: raw.stock_alerts_waiting }),
    // Phase 10 §4 and §5: weight (grams, null = the store's default), product type and gift card amounts.
    ...productPhase10(raw),
  }
}

/** Phase 10: { weight, type, giftCardAmounts, giftCardMinAmount, giftCardMaxAmount } (only what the API sent). */
function productPhase10(raw) {
  const fields = {}
  if (raw.weight !== undefined) fields.weight = Number.isInteger(raw.weight) ? raw.weight : null
  if (raw.type !== undefined) fields.type = raw.type === 'gift_card' ? 'gift_card' : 'simple'
  if (raw.gift_card !== undefined) {
    const card = raw.gift_card && typeof raw.gift_card === 'object' ? raw.gift_card : {}
    fields.giftCardAmounts = (Array.isArray(card.amounts) ? card.amounts : []).map(money).filter((amount) => Number.isFinite(amount))
    fields.giftCardMinAmount = money(card.custom?.min)
    fields.giftCardMaxAmount = money(card.custom?.max)
  }
  return fields
}

/** Admin form values (already validated) → the API's product fields. */
function toProductBody(values) {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [PRODUCT_FIELDS[field], value]))
}

const customerName = (raw) => raw.customer?.name ?? [raw.shipping_address?.first_name, raw.shipping_address?.last_name].filter(Boolean).join(' ')

/** AdminOrderResource → a row of the admin's order list. */
function adminOrderRow(raw) {
  return {
    id: raw.number,
    number: raw.number,
    customer: customerName(raw) || raw.email,
    email: raw.email,
    guest: !raw.customer,
    products: raw.items?.length ?? 0,
    items: raw.totals?.item_count ?? 0,
    subtotal: money(raw.totals?.subtotal),
    total: money(raw.totals?.total),
    status: raw.status,
    paymentStatus: raw.payment_status,
    paymentMethod: raw.payment_method,
    placedAt: raw.placed_at,
    // Phase 6: where the order came from (storefront | admin).
    source: raw.source ?? 'storefront',
  }
}

/** AdminOrderResource with history → the admin's order detail (old keys kept, new ones added). */
function adminOrderDetail(raw) {
  const order = fromOrder(raw)
  const [firstName, ...rest] = (customerName(raw) || '').split(' ')
  return {
    ...order,
    id: raw.number,
    customer: {
      id: raw.customer?.id ?? null,
      guest: !raw.customer,
      firstName,
      lastName: rest.join(' '),
      email: raw.customer?.email ?? raw.email,
      phone: raw.phone,
      city: order.shippingAddress?.city,
      country: order.shippingAddress?.country,
    },
    lines: (raw.items ?? []).map((item) => ({
      id: item.product_id,
      // Phase 6: the order line itself (returns name it).
      orderItemId: item.id ?? item.order_item_id ?? null,
      sku: item.sku,
      title: item.name,
      variantLabel: item.variant_label ?? null,
      thumbnail: item.thumbnail_url ?? null,
      price: money(item.sale_price),
      listPrice: money(item.price),
      discountPercentage: Number(item.discount_percent ?? 0),
      quantity: item.quantity,
      total: money(item.price) * item.quantity,
      discountedTotal: money(item.line_total),
      // Phase 10 §5: a gift card bought for someone (amount, recipient, message).
      ...(item.gift_card && { giftCard: lineGiftCard(item) }),
    })),
    subtotal: order.totals.subtotal,
    total: order.totals.total,
    items: order.totals.itemCount,
    shipments: (raw.shipments ?? []).map(adminShipment),
    invoices: (raw.invoices ?? []).map(adminInvoice),
    creditMemos: (raw.credit_memos ?? []).map(adminCreditMemo),
    // Phase 6: where it came from, the customer's group then, who created it, its returns.
    source: raw.source ?? 'storefront',
    customerGroup: typeof raw.customer_group === 'string' ? raw.customer_group : null,
    createdByAdmin: typeof raw.created_by_admin?.name === 'string' ? raw.created_by_admin.name : null,
    returns: (Array.isArray(raw.returns) ? raw.returns : []).map((entry) => ({ number: entry.number, status: entry.status, itemCount: entry.items_count ?? null, createdAt: entry.created_at ?? null })),
    returnEligibility: returnEligibility(raw.return_eligibility),
    // Phase 8: Stripe provider, reference, paid at, and the payment link (phase 10: PayPal too).
    payment: adminPayment(raw.payment),
    // Phase 10 §5: what a redeemed gift card paid ({ last4, amount } | null), and the cards this order bought.
    giftCardPayment: orderGiftCardPayment(raw),
    giftCardsIssued: issuedGiftCards(raw),
    history: (raw.history ?? []).map((entry) => ({
      status: entry.status,
      paymentStatus: entry.payment_status ?? null,
      note: entry.note ?? null,
      adminName: entry.admin_name ?? null,
      customerNotified: entry.customer_notified === true,
      createdAt: entry.created_at,
    })),
    live: true,
  }
}

// A Stripe id (PaymentIntent pi_…, refund re_…): letters, digits, underscores only, so it is safe in a URL path.
const stripeId = (value) => (typeof value === 'string' && /^[A-Za-z0-9_]{3,255}$/.test(value) ? value : null)
const httpsUrl = (value) => (typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value) ? value : null)

// Stripe's dashboard, the only place a payment's link may point to.
const STRIPE_DASHBOARD = /^https:\/\/dashboard\.stripe\.com\/(test\/)?payments\/[A-Za-z0-9_]+$/
// Phase 10 §3: PayPal's activity page for a capture, sandbox or live.
const PAYPAL_DASHBOARD = /^https:\/\/www\.(sandbox\.)?paypal\.com\/activity\/payment\/[A-Za-z0-9]+$/

/**
 * Phase 8: the order's card payment through Stripe (the API's `payment`
 * summary, staff view): provider, PaymentIntent reference with its Stripe
 * dashboard link, paid at, and the open payment page (`url`) to copy and send.
 * The API builds the dashboard link (test or live, from its key); without
 * one, the test dashboard is assumed (BuyNest runs on test keys first).
 */
export function adminPayment(raw) {
  const payment = raw && typeof raw === 'object' ? raw : {}
  const reference = stripeId(payment.reference)
  // Phase 10 §3: a PayPal capture links to PayPal's dashboard (the API says sandbox or live); nothing is guessed.
  if (payment.provider === 'paypal') return { ...paymentFields(payment), ...payPalDashboard(payment, reference) }
  const given = typeof payment.dashboard_url === 'string' && STRIPE_DASHBOARD.test(payment.dashboard_url) ? payment.dashboard_url : null
  const dashboardUrl = given ?? (reference && payment.provider !== 'gift_card' ? `https://dashboard.stripe.com/test/payments/${reference}` : null)
  return {
    ...paymentFields(payment),
    reference,
    dashboardUrl,
    mode: dashboardUrl?.includes('/test/') ? 'test' : dashboardUrl ? 'live' : null,
  }
}

function payPalDashboard(payment, reference) {
  const dashboardUrl = typeof payment.dashboard_url === 'string' && PAYPAL_DASHBOARD.test(payment.dashboard_url) ? payment.dashboard_url : null
  return { reference, dashboardUrl, mode: dashboardUrl ? (dashboardUrl.includes('.sandbox.') ? 'sandbox' : 'live') : null }
}

/** The fields every provider has: provider, paid at, the open payment page, and whether it can still be paid. */
function paymentFields(payment) {
  return {
    provider: typeof payment.provider === 'string' ? payment.provider : null,
    paidAt: typeof payment.paid_at === 'string' ? payment.paid_at : null,
    url: httpsUrl(payment.url),
    expiresAt: typeof payment.expires_at === 'string' ? payment.expires_at : null,
    canPay: payment.can_pay === true,
    ...(typeof payment.error === 'string' && payment.error && { error: payment.error.slice(0, 300) }),
  }
}

/** Phase 6: whether the order can be returned now, and how much of each line. */
function returnEligibility(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    eligible: raw.eligible === true,
    code: typeof raw.code === 'string' ? raw.code : null,
    message: typeof raw.message === 'string' ? raw.message : null,
    deadline: raw.deadline ?? null,
    windowDays: Number.isInteger(raw.window_days) ? raw.window_days : null,
    reasons: (Array.isArray(raw.reasons) ? raw.reasons : []).filter((reason) => typeof reason === 'string'),
    items: (Array.isArray(raw.items) ? raw.items : []).map((item) => ({
      orderItemId: item.order_item_id,
      name: item.name ?? '',
      variantLabel: item.variant_label ?? null,
      sku: item.sku ?? null,
      ordered: item.ordered ?? 0,
      returnable: item.returnable ?? 0,
    })),
  }
}

const pageOf = ({ limit, skip }) => ({ page: Math.floor(skip / limit) + 1, perPage: limit })

/** ?search&page&per_page (+ extra filters) for the admin's list endpoints. */
function listParams({ q, limit, skip, ...filters }) {
  const { page, perPage } = pageOf({ limit, skip })
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) })
  if (q) params.set('search', q)
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
  return params
}

// ---- phase 3 documents (docs/backend/PHASE3_CONTRACT.md) ----

const adminShipment = (raw) => ({ ...fromShipment(raw), orderNumber: raw.order_number ?? null, adminName: raw.admin_name ?? null, note: raw.note ?? null })

/** InvoiceResource → the admin's invoice (lists may leave out the items and totals). */
export function adminInvoice(raw) {
  return {
    number: raw.number,
    orderNumber: raw.order_number ?? null,
    amount: money(raw.amount),
    createdAt: raw.created_at,
    adminName: raw.admin_name ?? null,
    note: raw.note ?? null,
    ...(raw.billing_address && { billingAddress: fromAddress(raw.billing_address) }),
    ...(raw.items && { items: raw.items.map(fromLine) }),
    ...(raw.totals && { totals: fromTotals(raw.totals) }),
  }
}

/** CreditMemoResource → the admin's credit memo. */
export function adminCreditMemo(raw) {
  return {
    number: raw.number,
    orderNumber: raw.order_number ?? null,
    items: (raw.items ?? []).map((item) => ({ name: item.name, variantLabel: item.variant_label ?? null, sku: item.sku ?? null, quantity: item.quantity, amount: money(item.amount) })),
    subtotal: money(raw.subtotal),
    shippingRefund: money(raw.shipping_refund) ?? 0,
    adjustment: money(raw.adjustment) ?? 0,
    total: money(raw.total),
    restocked: raw.restocked === true,
    returnNumber: typeof raw.return_number === 'string' ? raw.return_number : null,
    // Phase 8: Stripe's refund id when the money went back to the card through Stripe (phase 10: or PayPal's).
    refundReference: stripeId(raw.refund_reference),
    // Phase 10 §5: what went back to a gift card, and the rest (by the other payment method).
    ...(raw.gift_card_refund !== undefined && { giftCardRefund: money(raw.gift_card_refund) ?? 0, otherRefund: money(raw.other_refund) ?? money(raw.total) - (money(raw.gift_card_refund) ?? 0) }),
    createdAt: raw.created_at,
    adminName: raw.admin_name ?? null,
    note: raw.note ?? null,
  }
}

/** /refundable → the refund form's limits. */
function refundLimits(raw) {
  return {
    items: (raw.items ?? []).map((item) => ({
      orderItemId: item.order_item_id,
      name: item.name,
      variantLabel: item.variant_label ?? null,
      sku: item.sku ?? null,
      ordered: item.ordered,
      refunded: item.refunded,
      refundable: item.refundable,
      unitRefund: money(item.unit_refund),
    })),
    shippingRefundable: money(raw.shipping_refundable) ?? 0,
    maxTotal: money(raw.max_total) ?? 0,
    // Phase 10 §5: what can still go back to the redeemed gift card (refunds go there first).
    ...(raw.gift_card_refundable !== undefined && raw.gift_card_refundable !== null && { giftCardRefundable: money(raw.gift_card_refundable) ?? 0 }),
  }
}

/** CouponResource → the admin's coupon. */
export function adminCoupon(raw) {
  return {
    id: raw.id,
    code: raw.code,
    description: raw.description ?? '',
    type: raw.type,
    value: money(raw.value) ?? 0,
    minSubtotal: money(raw.min_subtotal),
    startsAt: raw.starts_at ?? null,
    endsAt: raw.ends_at ?? null,
    usageLimit: raw.usage_limit ?? null,
    usageLimitPerCustomer: raw.usage_limit_per_customer ?? null,
    timesUsed: raw.times_used ?? 0,
    isActive: raw.is_active === true,
    status: raw.status,
    // Phase 7 (marketing): cart price rules.
    customerGroupIds: Array.isArray(raw.customer_group_ids) ? raw.customer_group_ids : [],
    appliesTo: raw.applies_to ?? 'all',
    categoryIds: Array.isArray(raw.category_ids) ? raw.category_ids : [],
    productIds: Array.isArray(raw.product_ids) ? raw.product_ids : [],
    freeShipping: raw.free_shipping === true,
    buyQuantity: raw.buy_quantity ?? null,
    getQuantity: raw.get_quantity ?? null,
    autoApply: raw.auto_apply === true,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  }
}

// Coupon form field → API field. Money goes as 2-decimal strings, like every amount in the API.
const COUPON_FIELDS = {
  code: 'code',
  description: 'description',
  type: 'type',
  value: 'value',
  minSubtotal: 'min_subtotal',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  usageLimit: 'usage_limit',
  usageLimitPerCustomer: 'usage_limit_per_customer',
  isActive: 'is_active',
  // Phase 7 (marketing): cart price rules.
  customerGroupIds: 'customer_group_ids',
  appliesTo: 'applies_to',
  categoryIds: 'category_ids',
  productIds: 'product_ids',
  freeShipping: 'free_shipping',
  buyQuantity: 'buy_quantity',
  getQuantity: 'get_quantity',
  autoApply: 'auto_apply',
}
const COUPON_MONEY = ['value', 'minSubtotal']
const toCouponBody = (values) =>
  Object.fromEntries(
    Object.entries(values).map(([field, value]) => [COUPON_FIELDS[field], COUPON_MONEY.includes(field) && typeof value === 'number' ? value.toFixed(2) : value]),
  )
const cents = (value) => (typeof value === 'number' ? value.toFixed(2) : undefined)

export const laravelAdminData = {
  async overview(token, request) {
    const result = await laravel('/api/admin/v1/overview', { token, request })
    // Phase 7 (system): each block is only there with its permission (products.view, orders.view, …): null when left out.
    return answer(result, [200], ({ data }) => ({
      products: data.products
        ? {
            total: data.products.total,
            active: data.products.active,
            outOfStock: data.products.out_of_stock,
            lowStock: data.products.low_stock,
            inventoryValue: money(data.products.inventory_value),
          }
        : null,
      orders: data.orders
        ? {
            total: data.orders.total,
            revenue: money(data.orders.revenue),
            unitsSold: data.orders.units_sold,
            averageOrder: money(data.orders.average_order),
            byStatus: data.orders.by_status ?? {},
          }
        : null,
      customers: data.customers ? { total: data.customers.total } : null,
      lowStockProducts: Array.isArray(data.low_stock_products)
        ? data.low_stock_products.map((product) => ({
            id: product.id,
            title: product.name,
            sku: product.sku,
            category: typeof product.category === 'object' ? product.category?.slug : product.category,
            stock: product.stock_quantity,
            thumbnail: product.thumbnail_url,
          }))
        : null,
      latestOrders: Array.isArray(data.latest_orders)
        ? data.latest_orders.map((order) => ({
            id: order.number,
            number: order.number,
            customer: order.customer_name || order.email,
            email: order.email,
            items: order.items,
            total: money(order.total),
            status: order.status,
            placedAt: order.placed_at,
          }))
        : null,
      ...dashboardBlocks(data),
      lowStockThreshold: data.low_stock_threshold,
      live: true,
    }))
  },

  async listProducts(token, { q, category, status, sortBy, order, limit, skip }, request) {
    const { page, perPage } = pageOf({ limit, skip })
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) })
    if (q) params.set('search', q)
    if (category) params.set('category', category)
    if (status) params.set('status', status)
    if (PRODUCT_SORT[sortBy]) {
      params.set('sort', PRODUCT_SORT[sortBy])
      params.set('direction', order)
    }
    const result = await laravel(`/api/admin/v1/products?${params}`, { token, request })
    return answer(result, [200], (data) => ({ products: data.data.map(adminProduct), total: data.meta?.total ?? data.data.length, limit, skip, live: true }))
  },

  async getProduct(token, id, request) {
    return answer(await laravel(`/api/admin/v1/products/${id}`, { token, request }), [200], (data) => ({ ...adminProduct(data.data), live: true }))
  },

  async createProduct(token, values, request) {
    const result = await laravel('/api/admin/v1/products', { method: 'POST', token, request, body: toProductBody(values) })
    return answer(result, [200, 201], (data) => ({ product: adminProduct(data.data), live: true }), FORM_FIELD)
  },

  async updateProduct(token, id, values, request) {
    const result = await laravel(`/api/admin/v1/products/${id}`, { method: 'PATCH', token, request, body: toProductBody(values) })
    return answer(result, [200], (data) => ({ product: adminProduct(data.data), live: true }), FORM_FIELD)
  },

  async deleteProduct(token, id, request) {
    const result = await laravel(`/api/admin/v1/products/${id}`, { method: 'DELETE', token, request })
    return answer(result, [200, 204], () => ({ id: Number(id), deleted: true, live: true }))
  },

  async listOrders(token, { q, status, paymentStatus, source, limit, skip }, request) {
    const { page, perPage } = pageOf({ limit, skip })
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) })
    if (q) params.set('search', q)
    if (status) params.set('status', status)
    if (paymentStatus) params.set('payment_status', paymentStatus)
    if (source) params.set('source', source)
    const result = await laravel(`/api/admin/v1/orders?${params}`, { token, request })
    return answer(result, [200], (data) => ({ orders: data.data.map(adminOrderRow), total: data.meta?.total ?? data.data.length, limit, skip, live: true }))
  },

  async getOrder(token, number, request) {
    return answer(await laravel(`/api/admin/v1/orders/${number}`, { token, request }), [200], (data) => adminOrderDetail(data.data))
  },

  /** { note?, notifyCustomer } → 201 { invoice }. Records the payment (pending_payment → processing). */
  async createInvoice(token, number, { note, notifyCustomer }, request) {
    const result = await laravel(`/api/admin/v1/orders/${number}/invoices`, { method: 'POST', token, request, body: { ...(note && { note }), notify_customer: notifyCustomer } })
    return answer(result, [200, 201], (data) => ({ invoice: adminInvoice(data.data), live: true }), ORDER_FIELDS)
  },

  /** { carrier, trackingNumber?, note?, notifyCustomer } → 201 { shipment }. */
  async createShipment(token, number, { carrier, trackingNumber, note, notifyCustomer }, request) {
    const body = { carrier, ...(trackingNumber && { tracking_number: trackingNumber }), ...(note && { note }), notify_customer: notifyCustomer }
    const result = await laravel(`/api/admin/v1/orders/${number}/shipments`, { method: 'POST', token, request, body })
    return answer(result, [200, 201], (data) => ({ shipment: adminShipment(data.data), live: true }), ORDER_FIELDS)
  },

  /** { items: [{ orderItemId, quantity }], shippingRefund, adjustment, restock, note?, notifyCustomer } → 201 { creditMemo }. */
  async createCreditMemo(token, number, memo, request) {
    const body = {
      items: memo.items.map((item) => ({ order_item_id: item.orderItemId, quantity: item.quantity })),
      shipping_refund: cents(memo.shippingRefund),
      adjustment: cents(memo.adjustment),
      restock: memo.restock,
      ...(memo.note && { note: memo.note }),
      notify_customer: memo.notifyCustomer,
      ...(memo.returnNumber && { return_number: memo.returnNumber }),
    }
    const result = await laravel(`/api/admin/v1/orders/${number}/credit-memos`, { method: 'POST', token, request, body })
    return answer(result, [200, 201], (data) => ({ creditMemo: adminCreditMemo(data.data), live: true }), ORDER_FIELDS)
  },

  async refundable(token, number, request) {
    return answer(await laravel(`/api/admin/v1/orders/${number}/refundable`, { token, request }), [200], (data) => refundLimits(data.data))
  },

  async listInvoices(token, filters, request) {
    const result = await laravel(`/api/admin/v1/invoices?${listParams(filters)}`, { token, request })
    return answer(result, [200], (data) => ({ invoices: data.data.map(adminInvoice), total: data.meta?.total ?? data.data.length, limit: filters.limit, skip: filters.skip, live: true }))
  },

  async getInvoice(token, number, request) {
    return answer(await laravel(`/api/admin/v1/invoices/${number}`, { token, request }), [200], (data) => ({ ...adminInvoice(data.data), live: true }))
  },

  async listCreditMemos(token, filters, request) {
    const result = await laravel(`/api/admin/v1/credit-memos?${listParams(filters)}`, { token, request })
    return answer(result, [200], (data) => ({ creditMemos: data.data.map(adminCreditMemo), total: data.meta?.total ?? data.data.length, limit: filters.limit, skip: filters.skip, live: true }))
  },

  async getCreditMemo(token, number, request) {
    return answer(await laravel(`/api/admin/v1/credit-memos/${number}`, { token, request }), [200], (data) => ({ ...adminCreditMemo(data.data), live: true }))
  },

  async listCoupons(token, filters, request) {
    const result = await laravel(`/api/admin/v1/coupons?${listParams(filters)}`, { token, request })
    return answer(result, [200], (data) => ({ coupons: data.data.map(adminCoupon), total: data.meta?.total ?? data.data.length, limit: filters.limit, skip: filters.skip, live: true }))
  },

  async getCoupon(token, id, request) {
    return answer(await laravel(`/api/admin/v1/coupons/${id}`, { token, request }), [200], (data) => ({ ...adminCoupon(data.data), live: true }))
  },

  async createCoupon(token, values, request) {
    const result = await laravel('/api/admin/v1/coupons', { method: 'POST', token, request, body: toCouponBody(values) })
    return answer(result, [200, 201], (data) => ({ coupon: adminCoupon(data.data), live: true }))
  },

  async updateCoupon(token, id, values, request) {
    const result = await laravel(`/api/admin/v1/coupons/${id}`, { method: 'PATCH', token, request, body: toCouponBody(values) })
    return answer(result, [200], (data) => ({ coupon: adminCoupon(data.data), live: true }))
  },

  /** A used coupon is only disabled (200 with the coupon, so past orders keep it); an unused one is deleted (204). */
  async deleteCoupon(token, id, request) {
    const result = await laravel(`/api/admin/v1/coupons/${id}`, { method: 'DELETE', token, request })
    return answer(result, [200, 204], (data) =>
      result.status === 200 && data?.data ? { id: Number(id), disabled: true, coupon: adminCoupon(data.data), live: true } : { id: Number(id), deleted: true, live: true },
    )
  },

  /** Phase 8: a Stripe payment link for an unpaid card order → { payment, order } (url null + error when Stripe can't be reached). */
  async paymentLink(token, number, request) {
    const result = await laravel(`/api/admin/v1/orders/${number}/payment-link`, { method: 'POST', token, request })
    return answer(result, [200, 201], (data) => {
      const order = adminOrderDetail(data.data)
      return { payment: order.payment, order, live: true }
    })
  },

  /** { status?, paymentStatus?, note?, notifyCustomer? } → the updated order. */
  async updateOrder(token, number, changes, request) {
    const body = {
      ...(changes.status && { status: changes.status }),
      ...(changes.paymentStatus && { payment_status: changes.paymentStatus }),
      ...(changes.note && { note: changes.note }),
      notify_customer: changes.notifyCustomer !== false,
    }
    const result = await laravel(`/api/admin/v1/orders/${number}`, { method: 'PATCH', token, request, body })
    return answer(result, [200], (data) => adminOrderDetail(data.data), ORDER_FIELDS)
  },
}
