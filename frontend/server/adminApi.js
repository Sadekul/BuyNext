import { json, pick, readBody, upstream } from './http.js'
import { accounts } from './accounts/index.js'
import { laravelAdminData } from './shop/admin.js'
import { SYSTEM_ROUTES, isReportName } from './adminSystemApi.js'
// Phase 7 (marketing): price rules, cart-rule coupon fields, newsletter, abandoned carts, search terms.
import { COUPON_KINDS, checkCouponRuleFields, matchMarketingRoute } from './adminMarketingApi.js'
// Phase 7 (system): email templates, URL redirects, notifications, grid preferences.
import { CONTENT_RESOURCES, matchContentRoute } from './adminContentApi.js'
import { CATALOG_ROUTES, NAMED_ACTIONS, PRODUCT_PARTS } from './adminCatalogApi.js'
import { laravelCatalogData } from './shop/adminCatalog.js'
import {
  CUSTOMER_PARTS,
  SALES_NAMED_ACTIONS,
  SALES_ROUTES,
  isReturnNumber,
  isShipmentNumber,
  laravelAccounts,
  listCustomersFromLaravel,
  updateCustomerInLaravel,
} from './adminSalesApi.js'
import { ADMIN, clearedCookies, notSignedIn, sessionCookies } from './session.js'

/*
 * BuyNest admin service, at /api/admin/* (used by the admin app in buynest/admin).
 *
 * ADMINS HAVE THEIR OWN SESSION: separate sign-in (/api/admin/auth/*) and
 * separate HttpOnly cookies (session.js ADMIN), never the storefront's. With
 * Laravel accounts, admins are a separate table: a customer can't sign in here
 * even with the right password. With the DummyJSON demo users, only users
 * whose role is "admin" can.
 *
 * PERMISSIONS ARE CHECKED HERE, ON THE SERVER: every request looks up the
 * admin session with the accounts backend and refuses anything else (401/403),
 * whatever the browser shows or hides. Responses are allow-listed: customer
 * records never include passwords, bank, or SSN data.
 *
 * DATA: customers come from Laravel when VITE_ACCOUNTS_BACKEND=laravel (real,
 * and admins can block them). Products, orders, and the overview come from
 * Laravel too when VITE_API_PROVIDER=laravel as well (shop/admin.js; answers
 * say `live: true`). Otherwise they are DummyJSON's demo data: DummyJSON
 * accepts product changes and answers as if it saved them, but it doesn't.
 * Those writes say `simulated: true`.
 *
 *   POST   /api/admin/auth/login         { email | username, password, remember } → the admin's profile
 *   POST   /api/admin/auth/refresh       → renews the admin session
 *   POST   /api/admin/auth/logout        → ends the admin session
 *   GET    /api/admin/me                 → the admin's profile
 *   GET    /api/admin/overview           → store totals, low stock, latest orders
 *   GET    /api/admin/products?q&category&status&limit&skip&sortBy&order
 *   GET    /api/admin/products/:id
 *   POST   /api/admin/products           → create (validated)
 *   PUT    /api/admin/products/:id       → update (validated, partial)
 *   DELETE /api/admin/products/:id
 *   GET    /api/admin/categories
 *   GET    /api/admin/orders?q&status&paymentStatus&source&limit&skip   (filters: Laravel only)
 *   GET    /api/admin/orders/:id          (Laravel: the order number, e.g. BN-100001)
 *   PATCH  /api/admin/orders/:number      { status?, paymentStatus?, note?, notifyCustomer? } (Laravel only)
 *
 * Phase 3 (Laravel only; docs/backend/PHASE3_CONTRACT.md):
 *   POST   /api/admin/orders/:number/invoices      { note?, notifyCustomer? } → 201 { invoice }
 *   POST   /api/admin/orders/:number/shipments     { carrier, trackingNumber?, note?, notifyCustomer? } → 201 { shipment }
 *   POST   /api/admin/orders/:number/credit-memos  { items: [{ orderItemId, quantity }], shippingRefund, adjustment,
 *                                                   restock, note?, notifyCustomer? } → 201 { creditMemo }
 *   GET    /api/admin/orders/:number/refundable    → { items: [{ orderItemId, name, sku, ordered, refunded, refundable, unitRefund }],
 *                                                     shippingRefundable, maxTotal }
 *   GET    /api/admin/invoices?q&limit&skip        → { invoices, total, limit, skip }
 *   GET    /api/admin/invoices/:number             (INV-100001)
 *   GET    /api/admin/credit-memos?q&limit&skip    → { creditMemos, total, limit, skip }
 *   GET    /api/admin/credit-memos/:number         (CM-100001)
 *   GET    /api/admin/coupons?q&status&kind&limit&skip  (status: active | inactive | scheduled | expired | used_up; phase 7 kind: code | automatic)
 *            phase 7 coupon fields: customerGroupIds, appliesTo (all | categories | products), categoryIds, productIds, freeShipping,
 *            buyQuantity, getQuantity (type buy_x_get_y), autoApply (code null)
 *   POST   /api/admin/coupons                      → 201 { coupon } (validated)
 *   GET    /api/admin/coupons/:id
 *   PATCH  /api/admin/coupons/:id                  → { coupon } (validated, partial)
 *   DELETE /api/admin/coupons/:id                  → { deleted: true } or, once used, { disabled: true, coupon }
 *   GET    /api/admin/customers?q&status&limit&skip
 *   PATCH  /api/admin/customers/:id      { isActive } → block or unblock (Laravel accounts only)
 *
 * Phase 4 (Laravel only; adminSystemApi.js): admin users, roles and
 * permissions, the audit log, CMS pages, the home page, reports, settings.
 * With roles, `GET me` also has `role: { id, name }` and `permissions`, and
 * the API answers 403 { code: "permission_denied", permission } to anything
 * the role can't do: passed on unchanged.
 *
 * Phase 5 (Laravel only; adminCatalogApi.js): the category tree, product
 * images (multipart upload), options and variants, mass actions, CSV export
 * and import, and review moderation. With real data, GET categories is the
 * tree as a flat list in tree order (parentId, depth, isActive, …).
 *
 * Phase 6 (Laravel only; adminSalesApi.js): customer groups, the customer
 * profile (edit, address book, notes, password reset, delete, CSV), orders
 * created by admins (quote, place), mass actions and CSV on the order grid,
 * packing slips, the shipments list, and returns (RMA). With Laravel
 * accounts, GET customers takes the new filters and rows carry the group, and
 * PATCH customers/:id edits the whole account (not only isActive).
 */

const PRODUCT_LIST_FIELDS = ['id', 'title', 'category', 'brand', 'price', 'discountPercentage', 'stock', 'rating', 'thumbnail', 'availabilityStatus']
const PRODUCT_DETAIL_FIELDS = [...PRODUCT_LIST_FIELDS, 'description', 'sku', 'minimumOrderQuantity', 'images', 'tags']
const CUSTOMER_FIELDS = ['id', 'firstName', 'lastName', 'username', 'email', 'phone', 'role', 'image']
const LOW_STOCK = 10
const MAX_PAGE = 100
const SORTABLE = ['title', 'price', 'stock', 'rating']
const PRODUCT_STATUSES = ['active', 'draft', 'archived']
const ORDER_STATUSES = ['pending_payment', 'processing', 'shipped', 'delivered', 'cancelled']

/** Real products and orders need both the Laravel catalog and Laravel admin accounts (its token). */
const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const fromLaravel = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))
const oneOf = (value, allowed) => (allowed.includes(value) ? value : undefined)

const toProduct = (raw, fields = PRODUCT_LIST_FIELDS) => pick(raw, fields)
const toCustomer = (raw) => ({ ...pick(raw, CUSTOMER_FIELDS), ...(raw.address && { city: raw.address.city, country: raw.address.country }) })
const fullName = (user) => [user?.firstName, user?.lastName].filter(Boolean).join(' ')

function pageParams(url) {
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), MAX_PAGE)
  const skip = Math.max(Number.parseInt(url.searchParams.get('skip') ?? '0', 10) || 0, 0)
  return { limit, skip }
}

const isId = (value) => /^\d{1,9}$/.test(value ?? '')
const isOrderNumber = (value) => /^BN-\d{1,12}$/.test(value ?? '')
const isInvoiceNumber = (value) => /^INV-\d{1,12}$/.test(value ?? '')
const isCreditMemoNumber = (value) => /^CM-\d{1,12}$/.test(value ?? '')
// How each resource's records are addressed in the URL; anything else is a 404 before any upstream call.
const ID_FORMATS = {
  orders: (value) => isId(value) || isOrderNumber(value),
  invoices: isInvoiceNumber,
  'credit-memos': isCreditMemoNumber,
  reports: isReportName,
  shipments: isShipmentNumber,
  returns: isReturnNumber,
}
const ORDER_DOCUMENTS = ['invoices', 'shipments', 'credit-memos', 'refundable', 'packing-slip', 'returns']
const CARRIERS = ['dhl', 'fedex', 'ups', 'usps', 'other']
// Phase 7 (marketing): + buy_x_get_y.
const COUPON_TYPES = ['percent', 'fixed', 'free_shipping', 'buy_x_get_y']
const COUPON_FILTERS = ['active', 'inactive', 'scheduled', 'expired', 'used_up']
const notFound = (what = 'That item') => json({ message: `${what} was not found.` }, 404)
const passThrough = ({ status, data }) => json({ message: data?.message ?? 'The request failed.' }, status)

/*
 * Server-side validation for product writes. Same shape as Laravel's 422
 * response ({ message, errors: { field: [messages] } }), so the admin form
 * shows field errors the same way now and after the switch.
 */
// At most 2 decimals, with a tolerance: in floating point 19.99 * 100 is 1998.9999999999998.
const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6

const PRODUCT_RULES = {
  title: (value) => (typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 120 ? null : 'Enter a name of 2 to 120 characters.'),
  description: (value) => (typeof value === 'string' && value.length <= 2000 ? null : 'Keep the description under 2000 characters.'),
  category: (value) => (typeof value === 'string' && /^[a-z0-9-]{2,40}$/.test(value) ? null : 'Choose a category.'),
  brand: (value) => (typeof value === 'string' && value.length <= 60 ? null : 'Keep the brand under 60 characters.'),
  price: (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000 && hasCents(value) ? null : 'Enter a price from 0 to 1,000,000 with at most 2 decimals.'),
  discountPercentage: (value) => (typeof value === 'number' && value >= 0 && value <= 90 ? null : 'Enter a discount from 0 to 90%.'),
  stock: (value) => (Number.isInteger(value) && value >= 0 && value <= 100_000 ? null : 'Enter a whole number of units from 0 to 100,000.'),
  status: (value) => (PRODUCT_STATUSES.includes(value) ? null : 'Choose active, draft, or archived.'),
  // Phase 7 (system): SEO; empty or null = none (the store falls back to the name and description).
  metaTitle: (value) => (value === null || (typeof value === 'string' && value.trim().length <= 190) ? null : 'Keep the meta title under 190 characters.'),
  metaDescription: (value) => (value === null || (typeof value === 'string' && value.trim().length <= 500) ? null : 'Keep the meta description under 500 characters.'),
}
const REQUIRED_ON_CREATE = ['title', 'category', 'price', 'stock']

export function validateProduct(body, { partial }) {
  const errors = {}
  const values = {}
  for (const [field, rule] of Object.entries(PRODUCT_RULES)) {
    if (body[field] === undefined) {
      if (!partial && REQUIRED_ON_CREATE.includes(field)) errors[field] = [rule(undefined)]
      continue
    }
    const problem = rule(body[field])
    if (problem) errors[field] = [problem]
    else values[field] = typeof body[field] === 'string' ? body[field].trim() : body[field]
  }
  // Phase 7 (system): a blank meta field is stored as null.
  for (const field of ['metaTitle', 'metaDescription']) if (values[field] === '') values[field] = null
  if (partial && Object.keys(values).length === 0 && Object.keys(errors).length === 0) {
    errors.title = ['Change at least one field.']
  }
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

const invalid = (errors) => json({ message: 'Please check the highlighted fields.', errors }, 422)
// An empty brand means "no brand" (the API creates brands by name).
const withoutBlankBrand = (values) => (values.brand === '' ? { ...values, brand: null } : values)

const LIVE_ONLY = 'This needs the BuyNest backend; the demo orders have no invoices, shipments, refunds, or coupons.'
const liveOnly = () => json({ message: LIVE_ONLY }, 404)
const isMoney = (value, { min = 0, max = 1_000_000 } = {}) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && hasCents(value)
const optionalNote = (body, errors) => {
  if (body.note !== undefined && body.note !== null && (typeof body.note !== 'string' || body.note.length > 1000)) errors.note = ['Keep the note under 1000 characters.']
  return typeof body.note === 'string' ? body.note.trim() || undefined : undefined
}

/** Invoice: only a note and the email choice; the amount is always the order's total (phase 3). */
export function validateInvoice(body) {
  const errors = {}
  const note = optionalNote(body, errors)
  return Object.keys(errors).length > 0 ? { errors } : { values: { note, notifyCustomer: body.notifyCustomer !== false } }
}

export function validateShipment(body) {
  const errors = {}
  if (!CARRIERS.includes(body.carrier)) errors.carrier = ['Choose a carrier.']
  const tracking = typeof body.trackingNumber === 'string' ? body.trackingNumber.trim() : ''
  if (body.trackingNumber !== undefined && body.trackingNumber !== null && typeof body.trackingNumber !== 'string') errors.trackingNumber = ['Enter the tracking number as text.']
  else if (tracking && !/^[A-Za-z0-9][A-Za-z0-9 -]{0,63}$/.test(tracking)) errors.trackingNumber = ['Use up to 64 letters, digits, spaces, or dashes.']
  const note = optionalNote(body, errors)
  if (Object.keys(errors).length > 0) return { errors }
  return { values: { carrier: body.carrier, trackingNumber: tracking || undefined, note, notifyCustomer: body.notifyCustomer !== false } }
}

/**
 * Credit memo: the shape only. The API checks the amounts against what was
 * paid and already refunded (422 with its own messages).
 */
export function validateCreditMemo(body) {
  const errors = {}
  const items = []
  if (body.items !== undefined && (!Array.isArray(body.items) || body.items.length > 200)) errors.items = ['Choose the items to refund.']
  else {
    for (const [index, item] of (body.items ?? []).entries()) {
      if (!Number.isInteger(item?.orderItemId) || item.orderItemId < 1) errors[`items.${index}.orderItemId`] = ['Choose an item of this order.']
      else if (!Number.isInteger(item.quantity) || item.quantity < 0 || item.quantity > 100_000) errors[`items.${index}.quantity`] = ['Enter a whole number of units.']
      else if (item.quantity > 0) items.push({ orderItemId: item.orderItemId, quantity: item.quantity })
    }
  }
  const shippingRefund = body.shippingRefund ?? 0
  const adjustment = body.adjustment ?? 0
  if (!isMoney(shippingRefund)) errors.shippingRefund = ['Enter a shipping refund of 0 or more, with at most 2 decimals.']
  if (!isMoney(adjustment, { min: -1_000_000 })) errors.adjustment = ['Enter an adjustment with at most 2 decimals (negative to keep a fee).']
  if (body.restock !== undefined && typeof body.restock !== 'boolean') errors.restock = ['Choose whether to return the items to stock.']
  // Phase 6: refunding a return (RMA-100001) marks it refunded.
  if (body.returnNumber !== undefined && body.returnNumber !== null && !/^RMA-\d{1,12}$/.test(body.returnNumber)) errors.returnNumber = ['Choose a return of this order.']
  const note = optionalNote(body, errors)
  if (Object.keys(errors).length > 0) return { errors }
  if (items.length === 0 && shippingRefund === 0 && adjustment <= 0) return { errors: { items: ['Choose at least one item, or refund shipping or an amount.'] } }
  return {
    values: { items, shippingRefund, adjustment, restock: body.restock === true, note, notifyCustomer: body.notifyCustomer !== false, ...(body.returnNumber && { returnNumber: body.returnNumber }) },
  }
}

const nullable = (rule) => (value) => (value === null ? null : rule(value))
const isDate = (value) => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(value) && !Number.isNaN(Date.parse(value))
const COUPON_RULES = {
  // Phase 7 (marketing): null for an automatic rule (checkCouponRuleFields decides when it's needed).
  code: nullable((value) => (typeof value === 'string' && /^[A-Za-z0-9_-]{3,40}$/.test(value.trim()) ? null : 'Use 3 to 40 letters, digits, dashes, or underscores.')),
  // Empty: the API writes one from the rules ("10% off your order").
  description: nullable((value) => (typeof value === 'string' && value.trim().length <= 255 ? null : 'Keep the description under 255 characters (shoppers see it).')),
  type: (value) => (COUPON_TYPES.includes(value) ? null : 'Choose percent, fixed amount, free shipping, or buy X get Y.'),
  value: (value) => (isMoney(value) ? null : 'Enter a value of 0 or more with at most 2 decimals.'),
  minSubtotal: nullable((value) => (isMoney(value) ? null : 'Enter a minimum of 0 or more with at most 2 decimals, or leave it empty.')),
  startsAt: nullable((value) => (isDate(value) ? null : 'Enter a valid start date, or leave it empty.')),
  endsAt: nullable((value) => (isDate(value) ? null : 'Enter a valid end date, or leave it empty.')),
  usageLimit: nullable((value) => (Number.isInteger(value) && value >= 1 && value <= 1_000_000 ? null : 'Enter a whole number from 1, or leave it empty for no limit.')),
  usageLimitPerCustomer: nullable((value) => (Number.isInteger(value) && value >= 1 && value <= 1_000_000 ? null : 'Enter a whole number from 1, or leave it empty for no limit.')),
  isActive: (value) => (typeof value === 'boolean' ? null : 'Choose whether the code can be used.'),
}

/** Coupon writes, Laravel-style errors. Cross-field rules (value per type, dates in order) when both fields are sent. */
export function validateCoupon(body, { partial }) {
  const errors = {}
  const values = {}
  for (const [field, rule] of Object.entries(COUPON_RULES)) {
    if (body[field] === undefined) {
      if (!partial && field === 'type') errors[field] = [rule(undefined)]
      continue
    }
    const problem = rule(body[field])
    if (problem) errors[field] = [problem]
    else values[field] = typeof body[field] === 'string' ? body[field].trim() : body[field]
  }
  if (values.code) values.code = values.code.toUpperCase()
  if (values.description === '') values.description = null
  // Phase 7 (marketing): groups, eligible lines, free shipping, buy X get Y, automatic rules (adminMarketingApi.js).
  checkCouponRuleFields(body, values, errors, { partial })
  if (values.type === 'free_shipping' || values.type === 'buy_x_get_y') values.value = 0 // no amount: free shipping, or the free units
  else if (values.type && values.value === undefined && !errors.value && !partial) errors.value = ['Enter the discount.']
  if (values.type === 'percent' && values.value !== undefined && (values.value < 1 || values.value > 100)) errors.value = ['Enter a percentage from 1 to 100.']
  if (values.type === 'fixed' && values.value !== undefined && values.value <= 0) errors.value = ['Enter an amount above 0.']
  if (values.startsAt && values.endsAt && Date.parse(values.endsAt) <= Date.parse(values.startsAt)) errors.endsAt = ['The end must be after the start.']
  if (partial && Object.keys(values).length === 0 && Object.keys(errors).length === 0) errors.code = ['Change at least one field.']
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

/** ?q&limit&skip for the document lists. */
const listFilters = (url) => ({ q: url.searchParams.get('q')?.trim().slice(0, 100) || undefined, ...pageParams(url) })

const ROUTES = {
  async 'GET me'(ctx) {
    return json(ctx.admin)
  },

  async 'GET overview'(ctx) {
    if (realData()) return fromLaravel(await laravelAdminData.overview(ctx.token, ctx.request))
    const [products, orders, customers] = await Promise.all([
      upstream('/products?limit=0&select=title,price,stock,category,thumbnail,discountPercentage'),
      upstream('/carts?limit=0'),
      upstream('/users?limit=0&select=firstName,lastName'),
    ])
    for (const result of [products, orders, customers]) if (result.status !== 200) return passThrough(result)

    const items = products.data.products
    const carts = orders.data.carts
    const names = new Map(customers.data.users.map((user) => [user.id, fullName(user)]))
    const inStock = items.filter((item) => item.stock > 0)
    // Money in cents to avoid floating-point drift, then back to dollars.
    const cents = (dollars) => Math.round(dollars * 100)
    const sum = (list, value) => list.reduce((total, entry) => total + cents(value(entry)), 0) / 100

    return json({
      products: {
        total: products.data.total,
        outOfStock: items.length - inStock.length,
        lowStock: inStock.filter((item) => item.stock < LOW_STOCK).length,
        inventoryValue: sum(items, (item) => item.price * item.stock),
      },
      orders: {
        total: orders.data.total,
        revenue: sum(carts, (cart) => cart.discountedTotal),
        unitsSold: carts.reduce((total, cart) => total + cart.totalQuantity, 0),
      },
      customers: { total: customers.data.total },
      lowStockProducts: items
        .filter((item) => item.stock < LOW_STOCK)
        .sort((a, b) => a.stock - b.stock || a.title.localeCompare(b.title))
        .slice(0, 6)
        .map((item) => toProduct(item)),
      // DummyJSON carts have no dates: the highest ids stand in for "latest".
      latestOrders: [...carts]
        .sort((a, b) => b.id - a.id)
        .slice(0, 6)
        .map((cart) => ({ id: cart.id, customer: names.get(cart.userId) ?? `Customer #${cart.userId}`, items: cart.totalQuantity, total: cart.discountedTotal })),
      lowStockThreshold: LOW_STOCK,
    })
  },

  async 'GET products'(ctx) {
    const { url } = ctx
    const { limit, skip } = pageParams(url)
    const q = url.searchParams.get('q')?.trim()
    const category = url.searchParams.get('category')
    const sortBy = url.searchParams.get('sortBy')
    const order = url.searchParams.get('order') === 'desc' ? 'desc' : 'asc'
    if (realData()) {
      const status = oneOf(url.searchParams.get('status'), PRODUCT_STATUSES)
      const filters = { q: q?.slice(0, 100), category: /^[a-z0-9-]{2,40}$/.test(category ?? '') ? category : undefined, status, sortBy, order, limit, skip }
      return fromLaravel(await laravelAdminData.listProducts(ctx.token, filters, ctx.request))
    }
    const params = new URLSearchParams({ limit, skip, select: PRODUCT_LIST_FIELDS.join(',') })
    if (SORTABLE.includes(sortBy)) {
      params.set('sortBy', sortBy)
      params.set('order', order)
    }
    let path = `/products?${params}`
    if (q) path = `/products/search?q=${encodeURIComponent(q)}&${params}`
    else if (category && /^[a-z0-9-]{2,40}$/.test(category)) path = `/products/category/${category}?${params}`
    const result = await upstream(path)
    if (result.status !== 200) return passThrough(result)
    return json({ products: result.data.products.map((item) => toProduct(item)), total: result.data.total, limit, skip })
  },

  async 'GET products/:id'(ctx) {
    if (realData()) return fromLaravel(await laravelAdminData.getProduct(ctx.token, ctx.id, ctx.request))
    const result = await upstream(`/products/${ctx.id}`)
    if (result.status === 404) return notFound('That product')
    if (result.status !== 200) return passThrough(result)
    return json(toProduct(result.data, PRODUCT_DETAIL_FIELDS))
  },

  async 'POST products'(ctx) {
    const { values, errors } = validateProduct(await readBody(ctx.request), { partial: false })
    if (errors) return invalid(errors)
    if (realData()) return fromLaravel(await laravelAdminData.createProduct(ctx.token, withoutBlankBrand(values), ctx.request), 201)
    const result = await upstream('/products/add', { method: 'POST', body: values })
    if (![200, 201].includes(result.status)) return passThrough(result)
    return json({ product: toProduct(result.data, PRODUCT_DETAIL_FIELDS), simulated: true }, 201)
  },

  async 'PUT products/:id'(ctx) {
    const { values, errors } = validateProduct(await readBody(ctx.request), { partial: true })
    if (errors) return invalid(errors)
    if (realData()) return fromLaravel(await laravelAdminData.updateProduct(ctx.token, ctx.id, withoutBlankBrand(values), ctx.request))
    const result = await upstream(`/products/${ctx.id}`, { method: 'PUT', body: values })
    if (result.status === 404) return notFound('That product')
    if (result.status !== 200) return passThrough(result)
    return json({ product: toProduct(result.data, PRODUCT_DETAIL_FIELDS), simulated: true })
  },

  async 'DELETE products/:id'(ctx) {
    if (realData()) return fromLaravel(await laravelAdminData.deleteProduct(ctx.token, ctx.id, ctx.request), 200)
    const result = await upstream(`/products/${ctx.id}`, { method: 'DELETE' })
    if (result.status === 404) return notFound('That product')
    if (result.status !== 200) return passThrough(result)
    return json({ id: result.data.id, deleted: true, simulated: true })
  },

  async 'GET categories'(ctx) {
    if (realData()) return fromLaravel(await laravelCatalogData.categories(ctx.token, ctx.request))
    const result = await upstream('/products/categories')
    if (result.status !== 200) return passThrough(result)
    return json(result.data.map((category) => pick(category, ['slug', 'name'])))
  },

  async 'GET orders'(ctx) {
    const { limit, skip } = pageParams(ctx.url)
    if (realData()) {
      const { searchParams } = ctx.url
      const filters = {
        q: searchParams.get('q')?.trim().slice(0, 100),
        status: oneOf(searchParams.get('status'), ORDER_STATUSES),
        paymentStatus: oneOf(searchParams.get('paymentStatus'), ['paid', 'unpaid']),
        source: oneOf(searchParams.get('source'), ['storefront', 'admin']),
        limit,
        skip,
      }
      return fromLaravel(await laravelAdminData.listOrders(ctx.token, filters, ctx.request))
    }
    const [orders, customers] = await Promise.all([upstream(`/carts?limit=${limit}&skip=${skip}`), upstream('/users?limit=0&select=firstName,lastName')])
    if (orders.status !== 200) return passThrough(orders)
    const names = new Map((customers.data.users ?? []).map((user) => [user.id, fullName(user)]))
    return json({
      orders: orders.data.carts.map((cart) => ({
        id: cart.id,
        customerId: cart.userId,
        customer: names.get(cart.userId) ?? `Customer #${cart.userId}`,
        products: cart.totalProducts,
        items: cart.totalQuantity,
        subtotal: cart.total,
        total: cart.discountedTotal,
      })),
      total: orders.data.total,
      limit,
      skip,
    })
  },

  async 'GET orders/:id'(ctx) {
    if (realData()) return isOrderNumber(ctx.id) ? fromLaravel(await laravelAdminData.getOrder(ctx.token, ctx.id, ctx.request)) : notFound('That order')
    if (!isId(ctx.id)) return notFound('That order')
    const order = await upstream(`/carts/${ctx.id}`)
    if (order.status === 404) return notFound('That order')
    if (order.status !== 200) return passThrough(order)
    const customer = await upstream(`/users/${order.data.userId}`)
    return json({
      id: order.data.id,
      customer: customer.status === 200 ? toCustomer(customer.data) : { id: order.data.userId },
      lines: order.data.products.map((line) =>
        pick(line, ['id', 'title', 'price', 'quantity', 'total', 'discountPercentage', 'discountedTotal', 'thumbnail']),
      ),
      subtotal: order.data.total,
      total: order.data.discountedTotal,
      items: order.data.totalQuantity,
    })
  },

  /*
   * Order status and payment (Laravel only). The API enforces which status
   * changes are allowed (422 otherwise); this only checks the shape.
   */
  async 'PATCH orders/:id'(ctx) {
    if (!realData()) return json({ message: 'Managing orders needs the BuyNest backend; the demo orders cannot change.' }, 404)
    if (!isOrderNumber(ctx.id)) return notFound('That order')
    const body = await readBody(ctx.request)
    const errors = {}
    if (body.status !== undefined && !ORDER_STATUSES.includes(body.status)) errors.status = ['Choose a valid status.']
    if (body.paymentStatus !== undefined && body.paymentStatus !== 'paid') errors.paymentStatus = ['Payment can only be marked as paid.']
    if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 1000)) errors.note = ['Keep the note under 1000 characters.']
    if (body.status === undefined && body.paymentStatus === undefined) errors.status = ['Choose a new status or mark the order as paid.']
    if (Object.keys(errors).length > 0) return invalid(errors)
    const changes = { status: body.status, paymentStatus: body.paymentStatus, note: body.note?.trim() || undefined, notifyCustomer: body.notifyCustomer !== false }
    return fromLaravel(await laravelAdminData.updateOrder(ctx.token, ctx.id, changes, ctx.request))
  },

  async 'POST orders/:id/invoices'(ctx) {
    if (!realData()) return liveOnly()
    const { values, errors } = validateInvoice(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelAdminData.createInvoice(ctx.token, ctx.id, values, ctx.request), 201)
  },

  async 'POST orders/:id/shipments'(ctx) {
    if (!realData()) return liveOnly()
    const { values, errors } = validateShipment(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelAdminData.createShipment(ctx.token, ctx.id, values, ctx.request), 201)
  },

  async 'POST orders/:id/credit-memos'(ctx) {
    if (!realData()) return liveOnly()
    const { values, errors } = validateCreditMemo(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelAdminData.createCreditMemo(ctx.token, ctx.id, values, ctx.request), 201)
  },

  async 'GET orders/:id/refundable'(ctx) {
    if (!realData()) return liveOnly()
    return fromLaravel(await laravelAdminData.refundable(ctx.token, ctx.id, ctx.request))
  },

  async 'GET invoices'(ctx) {
    if (!realData()) return liveOnly()
    return fromLaravel(await laravelAdminData.listInvoices(ctx.token, listFilters(ctx.url), ctx.request))
  },

  async 'GET invoices/:id'(ctx) {
    if (!realData()) return liveOnly()
    return fromLaravel(await laravelAdminData.getInvoice(ctx.token, ctx.id, ctx.request))
  },

  async 'GET credit-memos'(ctx) {
    if (!realData()) return liveOnly()
    return fromLaravel(await laravelAdminData.listCreditMemos(ctx.token, listFilters(ctx.url), ctx.request))
  },

  async 'GET credit-memos/:id'(ctx) {
    if (!realData()) return liveOnly()
    return fromLaravel(await laravelAdminData.getCreditMemo(ctx.token, ctx.id, ctx.request))
  },

  async 'GET coupons'(ctx) {
    if (!realData()) return liveOnly()
    // Phase 7 (marketing): ?kind=code|automatic.
    const filters = { ...listFilters(ctx.url), status: oneOf(ctx.url.searchParams.get('status'), COUPON_FILTERS), kind: oneOf(ctx.url.searchParams.get('kind'), COUPON_KINDS) }
    return fromLaravel(await laravelAdminData.listCoupons(ctx.token, filters, ctx.request))
  },

  async 'POST coupons'(ctx) {
    if (!realData()) return liveOnly()
    const { values, errors } = validateCoupon(await readBody(ctx.request), { partial: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelAdminData.createCoupon(ctx.token, values, ctx.request), 201)
  },

  async 'GET coupons/:id'(ctx) {
    if (!realData()) return liveOnly()
    return fromLaravel(await laravelAdminData.getCoupon(ctx.token, ctx.id, ctx.request))
  },

  async 'PATCH coupons/:id'(ctx) {
    if (!realData()) return liveOnly()
    const { values, errors } = validateCoupon(await readBody(ctx.request), { partial: true })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelAdminData.updateCoupon(ctx.token, ctx.id, values, ctx.request))
  },

  async 'DELETE coupons/:id'(ctx) {
    if (!realData()) return liveOnly()
    return fromLaravel(await laravelAdminData.deleteCoupon(ctx.token, ctx.id, ctx.request), 200)
  },

  async 'GET customers'(ctx) {
    const { url } = ctx
    const { limit, skip } = pageParams(url)
    const q = url.searchParams.get('q')?.trim()
    // Phase 6: straight from the API, with the group and the new filters.
    if (laravelAccounts()) return listCustomersFromLaravel(ctx)
    const backend = accounts()
    if (backend.admin.listCustomers) {
      const status = ['verified', 'unverified', 'blocked'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : undefined
      // The API pages by page number; this service by limit/skip.
      const result = await backend.admin.listCustomers(ctx.token, { search: q?.slice(0, 100), status, page: Math.floor(skip / limit) + 1, perPage: limit }, ctx.request)
      if (!result.ok) return json(result.body, result.status)
      return json({ ...result.data, limit, skip, manageable: true })
    }
    const select = 'firstName,lastName,username,email,phone,role,image,address'
    const path = q
      ? `/users/search?q=${encodeURIComponent(q)}&limit=${limit}&skip=${skip}&select=${select}`
      : `/users?limit=${limit}&skip=${skip}&select=${select}`
    const result = await upstream(path)
    if (result.status !== 200) return passThrough(result)
    return json({ customers: result.data.users.map(toCustomer), total: result.data.total, limit, skip, manageable: false })
  },

  async 'PATCH customers/:id'(ctx) {
    if (laravelAccounts()) return updateCustomerInLaravel(ctx)
    const backend = accounts()
    if (!backend.admin.updateCustomer) return json({ message: 'Blocking customers needs the BuyNest backend; the demo accounts cannot do it.' }, 404)
    const body = await readBody(ctx.request)
    if (typeof body.isActive !== 'boolean') return invalid({ isActive: ['Choose whether the account is active.'] })
    const result = await backend.admin.updateCustomer(ctx.token, ctx.id, { isActive: body.isActive }, ctx.request)
    return result.ok ? json(result.data) : json(result.body, result.status)
  },
  ...SYSTEM_ROUTES,
  ...CATALOG_ROUTES,
  ...SALES_ROUTES,
}

/**
 * /api/admin/<resource>[/<id>[/<document>]] → route key like "PUT products/:id"
 * or "POST orders/:id/invoices". Orders also go by number (BN-100001),
 * invoices and credit memos only by theirs (INV-…, CM-…).
 */
function matchRoute(method, segments) {
  // Phase 7 (marketing): catalog-rules, newsletter, search-terms, reports/abandoned-carts, reports/search-terms.
  const marketing = matchMarketingRoute(method, segments)
  if (marketing !== undefined) return marketing
  // Phase 7 (system): email-templates, redirects, notifications, preferences (adminContentApi.js has their routes).
  if (CONTENT_RESOURCES.includes(segments[0])) return matchContentRoute(method, segments)
  const [resource, id, document, ...rest] = segments
  // Phase 5: actions on a list (products/bulk) and a product's parts (products/1/images/2).
  if (document === undefined && [...NAMED_ACTIONS, ...SALES_NAMED_ACTIONS].includes(`${resource}/${id}`)) return { route: ROUTES[`${method} ${resource}/${id}`] }
  if (resource === 'products' && document !== undefined) return matchProductPart(method, id, document, rest)
  // Phase 6: a customer's addresses[/:addressId], notes, password-reset.
  if (resource === 'customers' && document !== undefined) return matchCustomerPart(method, id, document, rest)
  if (rest.length > 0) return null
  if (id === undefined) return { route: ROUTES[`${method} ${resource}`] }
  if (!(ID_FORMATS[resource] ?? isId)(id)) return null
  if (document === 'reset-password' && resource === 'admins') return { route: ROUTES[`${method} admins/:id/reset-password`], id }
  if (document === undefined) return { route: ROUTES[`${method} ${resource}/:id`], id }
  // Documents belong to an order, addressed by its number.
  if (resource !== 'orders' || !isOrderNumber(id) || !ORDER_DOCUMENTS.includes(document)) return null
  return { route: ROUTES[`${method} orders/:id/${document}`], id }
}

/** products/:id/images[/reorder | /:imageId], products/:id/options, products/:id/variants[/generate | /:variantId]. */
function matchProductPart(method, id, part, rest) {
  if (!isId(id) || !PRODUCT_PARTS[part] || rest.length > 1) return null
  if (rest.length === 0) return { route: ROUTES[`${method} products/:id/${part}`], id }
  const [sub] = rest
  if (PRODUCT_PARTS[part].includes(sub)) return { route: ROUTES[`${method} products/:id/${part}/${sub}`], id }
  return isId(sub) ? { route: ROUTES[`${method} products/:id/${part}/:sub`], id, sub } : null
}

/** customers/:id/addresses[/:addressId], customers/:id/notes, customers/:id/password-reset. */
function matchCustomerPart(method, id, part, rest) {
  if (!isId(id) || !Object.hasOwn(CUSTOMER_PARTS, part) || rest.length > 1) return null
  if (rest.length === 0) return { route: ROUTES[`${method} customers/:id/${part}`], id }
  return CUSTOMER_PARTS[part] && isId(rest[0]) ? { route: ROUTES[`${method} customers/:id/${part}/:sub`], id, sub: rest[0] } : null
}

/** The admin session routes: no permission check (they create or end the session). */
const SESSION_ROUTES = {
  async 'POST login'(request) {
    const body = await readBody(request)
    const remember = body.remember === true
    const result = await accounts().admin.login(body, remember, request)
    return result.ok ? json(result.profile, 200, sessionCookies(result.tokens, remember, ADMIN)) : json(result.body, result.status)
  },

  async 'POST refresh'(request, cookies) {
    if (!cookies[ADMIN.refresh]) return json({ message: 'Your session has expired.' }, 401, clearedCookies(ADMIN))
    const remember = cookies[ADMIN.remember] === '1'
    const result = await accounts().admin.refresh(cookies[ADMIN.refresh], remember, request)
    if (!result.ok) {
      const ended = [400, 401, 403].includes(result.status)
      return json(result.body, result.status, ended ? clearedCookies(ADMIN) : [])
    }
    return json({ ok: true }, 200, sessionCookies(result.tokens, remember, ADMIN))
  },

  async 'POST logout'(request, cookies) {
    await accounts().admin.logout(cookies[ADMIN.access], request)
    return json({ ok: true }, 200, clearedCookies(ADMIN))
  },
}

export async function handleAdminRequest(request, segments, cookies) {
  if (segments[0] === 'auth' && segments.length === 2) {
    const route = SESSION_ROUTES[`${request.method} ${segments[1]}`]
    return route ? route(request, cookies) : json({ message: 'Not found.' }, 404)
  }

  const match = matchRoute(request.method, segments)
  if (!match?.route) return json({ message: 'Not found.' }, 404)

  // The permission check, on every request: a valid ADMIN session.
  const token = cookies[ADMIN.access]
  if (!token) return notSignedIn()
  const session = await accounts().admin.me(token, request)
  if (!session.ok) return json(session.body, session.status, session.status === 403 ? clearedCookies(ADMIN) : [])

  return match.route({ request, url: new URL(request.url), id: match.id, sub: match.sub, admin: session.profile, token })
}
