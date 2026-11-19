import { json, laravelFile, readBody } from './http.js'
import { failed } from './shop/adminSystem.js'
import { laravelSalesData } from './shop/adminSales.js'

/*
 * Phase 6 admin routes (docs/backend/PHASE6_CONTRACT.md), Laravel only:
 * Magento-style customers and sales. Merged into adminApi.js's route table,
 * so the admin session check there runs first; the API then checks the role's
 * permission (customers.view/edit/create/delete, customer_groups.manage,
 * orders.view/create, invoices.create, shipments.create, orders.edit,
 * returns.view/manage) and answers 403 { code: "permission_denied", permission },
 * passed on unchanged.
 *
 *   GET    /api/admin/customer-groups               → { groups: [{ id, name, code, discountPercent, isSystem, customerCount }] }
 *   POST   /api/admin/customer-groups               { name, code, discountPercent } → 201 { group }
 *   PATCH  /api/admin/customer-groups/:id           (the same fields) → { group }
 *   DELETE /api/admin/customer-groups/:id           → { deleted: true } (422 when customers are in it, or it's a system group)
 *   GET    /api/admin/customers?q&status&verified&groupId&createdFrom&createdTo&limit&skip
 *                                                    → { customers: [{ id, firstName, lastName, email, phone, emailVerified, isActive,
 *                                                        group: { id, name, discountPercent }, groupId, createdAt, lastLoginAt }], total, manageable }
 *   GET    /api/admin/customers/export.csv?(the same filters) → the CSV file
 *   POST   /api/admin/customers                     { firstName, lastName, email, phone?, groupId? } → 201 { customer }
 *   GET    /api/admin/customers/:id                 → the customer + { addresses, ordersCount, lifetimeSpent,
 *                                                       recentOrders: [{ number, status, paymentStatus, source, total, placedAt }], reviewsCount, notes }
 *   PATCH  /api/admin/customers/:id                 { firstName?, lastName?, email?, phone?, groupId?, isActive? } → the customer
 *   DELETE /api/admin/customers/:id                 → { deleted: true } (422 while an order is open)
 *   POST   /api/admin/customers/:id/password-reset  → { sent: true, message }
 *   GET    /api/admin/customers/:id/addresses       → { addresses: [{ id, firstName, lastName, phone, company, line1, line2, city, state,
 *                                                        postalCode, country, isDefaultShipping, isDefaultBilling }] }
 *   POST   /api/admin/customers/:id/addresses       (an address) → 201 { address }
 *   PATCH  /api/admin/customers/:id/addresses/:aid  (fields to change) → { address }
 *   DELETE /api/admin/customers/:id/addresses/:aid  → { deleted: true }
 *   GET    /api/admin/customers/:id/notes           → { notes: [{ id, body, adminName, createdAt }] }
 *   POST   /api/admin/customers/:id/notes           { body } → 201 { note }
 *   POST   /api/admin/orders/quote                  (the order below) → { lines, problems, coupon, couponError, shippingOptions, totals,
 *                                                       taxEstimated, customerGroup, groupDiscountPercent }
 *   POST   /api/admin/orders                        { customerId | guest: { email, phone, firstName, lastName },
 *                                                       items: [{ productId, variantId?, quantity }], shippingAddress, billingAddress | sameAsShipping,
 *                                                       shippingMethod, paymentMethod, couponCode?, note?, notifyCustomer } → 201 { order: { number, … } }
 *   POST   /api/admin/orders/bulk                   { numbers (1–100), action: invoice | ship | cancel, carrier?, notifyCustomer? }
 *                                                    → { done: [numbers], skipped: [{ number, reason }] }
 *   GET    /api/admin/orders/export.csv?q&status&paymentStatus → the CSV file
 *   GET    /api/admin/orders/:number/packing-slip   → { orderNumber, placedAt, customerName, shippingAddress, shippingMethod,
 *                                                       items: [{ name, sku, variantLabel, quantity }], shipments }
 *   POST   /api/admin/orders/:number/returns        { items: [{ orderItemId, quantity }], reason, comment?, overrideWindow?, notifyCustomer } → 201 { return }
 *   GET    /api/admin/shipments?q&carrier&from&to&limit&skip → { shipments: [{ number, orderNumber, carrier, carrierLabel, trackingNumber,
 *                                                       trackingUrl, createdAt, adminName, itemCount, order? }], total }
 *   GET    /api/admin/shipments/:number             (SHP-100001) → the shipment + { items, order }
 *   GET    /api/admin/returns?status&q&limit&skip   → { returns: [{ number, orderNumber, status, reason, customer, email, itemCount, createdAt }], total }
 *   GET    /api/admin/returns/:number               (RMA-100001) → the return + { items: [{ id, orderItemId, name, sku, variantLabel, quantity, condition }],
 *                                                       comment, adminNote, resolution, creditMemoNumber, history? }
 *   PATCH  /api/admin/returns/:number               { status, adminNote?, resolution?, notifyCustomer, items?: [{ returnItemId, condition }], restock? } → { return }
 */

const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const fromLaravel = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))
const invalid = (errors, message = 'Please check the highlighted fields.') => json({ message, errors }, 422)
const LIVE_ONLY = 'This needs the BuyNest backend; the demo data has no customer groups, address books, returns, or shipments list.'
const liveOnly = () => json({ message: LIVE_ONLY }, 404)
const live = (handler) => (ctx) => (realData() ? handler(ctx) : liveOnly())

const MAX_PAGE = 100
function pageParams(url) {
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), MAX_PAGE)
  const skip = Math.max(Number.parseInt(url.searchParams.get('skip') ?? '0', 10) || 0, 0)
  return { limit, skip }
}

// ---- rules (Laravel-style errors: { field: [message] }) ----

const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const isId = (value) => Number.isInteger(value) && value > 0 && value < 1e9
const isText = (value, { min = 0, max }) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max
const isEmail = (value) => typeof value === 'string' && value.trim().length <= 190 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
const isPhone = (value) => typeof value === 'string' && value.trim().length <= 40 && /^\+?[\d\s()./-]{0,40}$/.test(value.trim())
const nullable = (rule) => (value) => (value === null ? null : rule(value))
const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))

function check(body, rules, required = []) {
  const errors = {}
  const values = {}
  for (const [field, rule] of Object.entries(rules)) {
    if (body?.[field] === undefined) {
      if (required.includes(field)) errors[field] = [rule(undefined) ?? 'This field is required.']
      continue
    }
    const problem = rule(body[field])
    if (problem) errors[field] = [problem]
    else values[field] = typeof body[field] === 'string' ? body[field].trim() : body[field]
  }
  return { errors, values }
}
const result = ({ errors, values }) => (Object.keys(errors).length > 0 ? { errors } : { values })

export const GROUP_RULES = {
  name: (value) => (isText(value, { min: 1, max: 60 }) ? null : 'Enter a name of up to 60 characters.'),
  code: (value) => (typeof value === 'string' && /^[a-z0-9_]{1,40}$/.test(value.trim()) ? null : 'Use up to 40 lower-case letters, digits, and underscores.'),
  discountPercent: (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 90 && hasCents(value) ? null : 'Enter a discount from 0 to 90%, with at most 2 decimals.'),
}
export function validateGroup(body, { partial }) {
  // A new group's code may be left out: the API makes one from the name.
  const checked = check(body, GROUP_RULES, partial ? [] : ['name', 'discountPercent'])
  if (partial && Object.keys(checked.values).length === 0 && Object.keys(checked.errors).length === 0) checked.errors.name = ['Change at least one field.']
  return result(checked)
}

const CUSTOMER_RULES = {
  firstName: (value) => (isText(value, { min: 1, max: 60 }) ? null : 'Enter a first name of up to 60 characters.'),
  lastName: (value) => (isText(value, { min: 1, max: 60 }) ? null : 'Enter a last name of up to 60 characters.'),
  email: (value) => (isEmail(value) ? null : 'Enter a valid email address.'),
  phone: nullable((value) => (isPhone(value) && value.trim() !== '' ? null : 'Enter a phone number with its country code, for example +1 555 010 0100.')),
  groupId: nullable((value) => (isId(value) ? null : 'Choose a customer group.')),
  isActive: (value) => (typeof value === 'boolean' ? null : 'Choose whether the account is active.'),
}
export function validateCustomer(body, { partial }) {
  const rules = partial ? CUSTOMER_RULES : Object.fromEntries(Object.entries(CUSTOMER_RULES).filter(([field]) => field !== 'isActive'))
  const checked = check(body, rules, partial ? [] : ['firstName', 'lastName', 'email', 'phone'])
  if (checked.values.email) checked.values.email = checked.values.email.toLowerCase()
  if (checked.values.phone === '') checked.values.phone = null
  if (partial && Object.keys(checked.values).length === 0 && Object.keys(checked.errors).length === 0) checked.errors.firstName = ['Change at least one field.']
  return result(checked)
}

const ADDRESS_RULES = {
  firstName: (value) => (isText(value, { min: 1, max: 60 }) ? null : 'Enter a first name of up to 60 characters.'),
  lastName: (value) => (isText(value, { min: 1, max: 60 }) ? null : 'Enter a last name of up to 60 characters.'),
  phone: nullable((value) => (isPhone(value) ? null : 'Enter a phone number (digits, spaces, + ( ) - .).')),
  company: nullable((value) => (isText(value, { max: 120 }) ? null : 'Keep the company under 120 characters.')),
  line1: (value) => (isText(value, { min: 1, max: 120 }) ? null : 'Enter the street address (up to 120 characters).'),
  line2: nullable((value) => (isText(value, { max: 120 }) ? null : 'Keep the second line under 120 characters.')),
  city: (value) => (isText(value, { min: 1, max: 80 }) ? null : 'Enter the city.'),
  state: nullable((value) => (isText(value, { max: 80 }) ? null : 'Keep the state under 80 characters.')),
  postalCode: (value) => (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(value.trim()) ? null : 'Enter a valid postal code.'),
  country: (value) => (isText(value, { min: 1, max: 60 }) ? null : 'Choose a country.'),
  isDefaultShipping: (value) => (typeof value === 'boolean' ? null : 'Choose whether this is the default shipping address.'),
  isDefaultBilling: (value) => (typeof value === 'boolean' ? null : 'Choose whether this is the default billing address.'),
}
const ADDRESS_REQUIRED = ['firstName', 'lastName', 'line1', 'city', 'postalCode', 'country']
// The address book also needs a phone (the courier calls it); order addresses don't have one.
const BOOK_REQUIRED = [...ADDRESS_REQUIRED, 'phone']
const blankToNull = (values, fields) => {
  for (const field of fields) if (values[field] === '') values[field] = null
  return values
}
export function validateAddress(body, { partial }) {
  const checked = check(body, ADDRESS_RULES, partial ? [] : BOOK_REQUIRED)
  if (!partial && checked.values.phone === '') checked.errors.phone = ['Enter a phone number.']
  blankToNull(checked.values, ['company', 'line2', 'state'])
  if (checked.values.phone === '') delete checked.values.phone
  if (partial && Object.keys(checked.values).length === 0 && Object.keys(checked.errors).length === 0) checked.errors.line1 = ['Change at least one field.']
  return result(checked)
}

/** An order's address ("shippingAddress.city" errors). */
function orderAddress(prefix, address, errors) {
  if (!address || typeof address !== 'object' || Array.isArray(address)) {
    errors[prefix] = ['Enter the address.']
    return undefined
  }
  const rules = Object.fromEntries(['firstName', 'lastName', 'line1', 'line2', 'city', 'state', 'postalCode', 'country'].map((field) => [field, ADDRESS_RULES[field]]))
  const checked = check(address, rules, ADDRESS_REQUIRED)
  for (const [field, messages] of Object.entries(checked.errors)) errors[`${prefix}.${field}`] = messages
  return blankToNull(checked.values, ['line2', 'state'])
}

export const SHIPPING_METHODS = ['standard', 'express', 'nextDay']
// The settings' methods, plus the two only admins may choose (the API decides which are on).
// Phase 12: + sslcommerz (the customer pays through the payment link; needs a phone number).
export const ADMIN_PAYMENT_METHODS = ['card', 'paypal', 'sslcommerz', 'cod', 'bank_transfer', 'cash']
export const MAX_ORDER_LINES = 50

/**
 * The create-order form. `quote` is lenient: the totals can be priced
 * before the addresses and methods are filled in (the API has the final word).
 */
export function validateAdminOrder(body, { quote }) {
  const errors = {}
  const values = { notifyCustomer: body.notifyCustomer !== false }
  if (body.customerId !== undefined && body.customerId !== null) {
    if (!isId(body.customerId)) errors.customerId = ['Choose a customer.']
    else values.customerId = body.customerId
  } else if (body.guest && typeof body.guest === 'object') {
    const guest = check(body.guest, { email: CUSTOMER_RULES.email, phone: CUSTOMER_RULES.phone, firstName: CUSTOMER_RULES.firstName, lastName: CUSTOMER_RULES.lastName }, quote ? [] : ['email', 'phone', 'firstName', 'lastName'])
    for (const [field, messages] of Object.entries(guest.errors)) errors[`guest.${field}`] = messages
    values.guest = { ...guest.values, ...(guest.values.email && { email: guest.values.email.toLowerCase() }) }
  } else if (!quote) errors.customerId = ['Choose a customer, or enter the guest’s details.']

  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_ORDER_LINES) errors.items = [`Add 1 to ${MAX_ORDER_LINES} products.`]
  else {
    values.items = []
    for (const [index, item] of body.items.entries()) {
      if (!isId(item?.productId)) errors[`items.${index}.productId`] = ['Choose a product.']
      else if (item.variantId !== undefined && item.variantId !== null && !isId(item.variantId)) errors[`items.${index}.variantId`] = ['Choose the options.']
      else if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) errors[`items.${index}.quantity`] = ['Enter a quantity from 1 to 999.']
      else values.items.push({ productId: item.productId, ...(item.variantId && { variantId: item.variantId }), quantity: item.quantity })
    }
  }

  if (quote) {
    // A quote only needs the country (for tax); the rest of the address may still be half filled.
    const country = body.shippingAddress?.country
    if (isText(country, { min: 1, max: 60 })) values.shippingAddress = { country: country.trim() }
  } else values.shippingAddress = orderAddress('shippingAddress', body.shippingAddress, errors)
  if (body.sameAsShipping === true || (body.billingAddress === undefined && !quote)) values.sameAsShipping = true
  else if (body.billingAddress !== undefined && body.billingAddress !== null && !quote) values.billingAddress = orderAddress('billingAddress', body.billingAddress, errors)

  if (body.shippingMethod !== undefined || !quote) {
    if (!SHIPPING_METHODS.includes(body.shippingMethod)) errors.shippingMethod = ['Choose a shipping method.']
    else values.shippingMethod = body.shippingMethod
  }
  if (body.paymentMethod !== undefined || !quote) {
    if (!ADMIN_PAYMENT_METHODS.includes(body.paymentMethod)) errors.paymentMethod = ['Choose a payment method.']
    else values.paymentMethod = body.paymentMethod
  }
  if (body.couponCode !== undefined && body.couponCode !== null && body.couponCode !== '') {
    if (typeof body.couponCode !== 'string' || !/^[A-Za-z0-9_-]{3,40}$/.test(body.couponCode.trim())) errors.couponCode = ['Enter a valid coupon code.']
    else values.couponCode = body.couponCode.trim().toUpperCase()
  }
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string' || body.note.length > 1000) errors.note = ['Keep the note under 1000 characters.']
    else if (body.note.trim()) values.note = body.note.trim()
  }
  if (quote) for (const field of Object.keys(errors)) if (!field.startsWith('items') && field !== 'customerId' && !field.startsWith('guest')) delete errors[field]
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

export const BULK_ORDER_ACTIONS = ['invoice', 'ship', 'cancel']
export const MAX_BULK_ORDERS = 100
const CARRIERS = ['dhl', 'fedex', 'ups', 'usps', 'other']
const isOrderNumber = (value) => typeof value === 'string' && /^BN-\d{1,12}$/.test(value)

export function validateBulkOrders(body) {
  const errors = {}
  const numbers = body.numbers
  if (!Array.isArray(numbers) || numbers.length < 1 || numbers.length > MAX_BULK_ORDERS || !numbers.every(isOrderNumber) || new Set(numbers).size !== numbers.length) {
    errors.numbers = [`Choose 1 to ${MAX_BULK_ORDERS} orders.`]
  }
  if (!BULK_ORDER_ACTIONS.includes(body.action)) errors.action = ['Choose an action.']
  if (body.action === 'ship' && !CARRIERS.includes(body.carrier)) errors.carrier = ['Choose a carrier.']
  if (Object.keys(errors).length > 0) return { errors }
  return { values: { numbers, action: body.action, ...(body.action === 'ship' && { carrier: body.carrier }), notifyCustomer: body.notifyCustomer !== false } }
}

export const RETURN_STATUSES = ['requested', 'approved', 'rejected', 'received', 'refunded', 'closed']
export const RETURN_CONDITIONS = ['unopened', 'opened', 'damaged']
const RESOLUTIONS = ['refund', 'replace']

/** PATCH a return. `refunded` is set by the credit memo, not here. */
export function validateReturnUpdate(body) {
  const errors = {}
  if (!RETURN_STATUSES.includes(body.status) || body.status === 'requested' || body.status === 'refunded') errors.status = ['Choose approve, reject, received, or close.']
  if (body.adminNote !== undefined && body.adminNote !== null && (typeof body.adminNote !== 'string' || body.adminNote.length > 1000)) errors.adminNote = ['Keep the note under 1000 characters.']
  if (body.resolution !== undefined && body.resolution !== null && !RESOLUTIONS.includes(body.resolution)) errors.resolution = ['Choose refund or replace.']
  let items
  if (body.status === 'received') {
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) errors.items = ['Give the condition of each returned item.']
    else {
      items = []
      for (const [index, item] of body.items.entries()) {
        if (!isId(item?.returnItemId)) errors[`items.${index}.returnItemId`] = ['Choose an item of this return.']
        else if (!RETURN_CONDITIONS.includes(item.condition)) errors[`items.${index}.condition`] = ['Choose unopened, opened, or damaged.']
        else items.push({ returnItemId: item.returnItemId, condition: item.condition })
      }
    }
    if (body.restock !== undefined && typeof body.restock !== 'boolean') errors.restock = ['Choose whether to return the items to stock.']
  }
  if (Object.keys(errors).length > 0) return { errors }
  return {
    values: {
      status: body.status,
      adminNote: typeof body.adminNote === 'string' ? body.adminNote.trim() || undefined : undefined,
      resolution: body.resolution ?? undefined,
      ...(items && { items, restock: body.restock === true }),
      notifyCustomer: body.notifyCustomer !== false,
    },
  }
}

/** POST orders/:number/returns (admin): the customer's rules, but the window can be overridden. */
export function validateReturnCreate(body) {
  const errors = {}
  const items = []
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) errors.items = ['Choose at least one item to return.']
  else {
    for (const [index, item] of body.items.entries()) {
      if (!isId(item?.orderItemId)) errors[`items.${index}.orderItemId`] = ['Choose an item of this order.']
      else if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) errors[`items.${index}.quantity`] = ['Enter a quantity of 1 or more.']
      else items.push({ orderItemId: item.orderItemId, quantity: item.quantity })
    }
  }
  if (!isText(body.reason, { min: 1, max: 60 })) errors.reason = ['Choose a reason.']
  if (body.comment !== undefined && body.comment !== null && (typeof body.comment !== 'string' || body.comment.length > 1000)) errors.comment = ['Keep the comment under 1000 characters.']
  if (body.resolution !== undefined && body.resolution !== null && !RESOLUTIONS.includes(body.resolution)) errors.resolution = ['Choose refund or replace.']
  if (Object.keys(errors).length > 0) return { errors }
  return {
    values: {
      items,
      reason: body.reason.trim(),
      comment: typeof body.comment === 'string' ? body.comment.trim() || undefined : undefined,
      resolution: body.resolution ?? undefined,
      overrideWindow: body.overrideWindow === true,
      notifyCustomer: body.notifyCustomer !== false,
    },
  }
}

// ---- list filters, in the API's names ----

/** ?q&status&verified&groupId&createdFrom&createdTo of the customer list. */
export function customerFilters(url) {
  const get = (key) => url.searchParams.get(key)
  const status = get('status')
  const verified = get('verified')
  return {
    q: get('q')?.trim().slice(0, 100) || undefined,
    status: ['active', 'blocked', 'verified', 'unverified'].includes(status) ? status : undefined,
    verified: verified === 'yes' || verified === 'true' ? '1' : verified === 'no' || verified === 'false' ? '0' : undefined,
    group_id: /^\d{1,9}$/.test(get('groupId') ?? '') ? get('groupId') : undefined,
    created_from: isDay(get('createdFrom')) ? get('createdFrom') : undefined,
    created_to: isDay(get('createdTo')) ? get('createdTo') : undefined,
  }
}

/** ?q&status&paymentStatus of the order grid. */
const ORDER_STATUSES = ['pending_payment', 'processing', 'shipped', 'delivered', 'cancelled', 'closed']
function orderFilters(url) {
  const params = new URLSearchParams()
  const q = url.searchParams.get('q')?.trim().slice(0, 100)
  const status = url.searchParams.get('status')
  const payment = url.searchParams.get('paymentStatus')
  const source = url.searchParams.get('source')
  if (q) params.set('search', q)
  if (ORDER_STATUSES.includes(status)) params.set('status', status)
  if (['paid', 'unpaid'].includes(payment)) params.set('payment_status', payment)
  if (['storefront', 'admin'].includes(source)) params.set('source', source)
  return params
}

// The file name from the API's Content-Disposition, if it's a plain one; else ours.
function downloadName(disposition, fallback) {
  const name = /filename="?([A-Za-z0-9._-]{1,100})"?/.exec(disposition ?? '')?.[1]
  return name && name.endsWith('.csv') ? name : fallback
}

/** A CSV download from the API, passed on with its type and a safe file name. */
async function csvFile(ctx, path, fallbackName) {
  const file = await laravelFile(path, { token: ctx.token, request: ctx.request })
  if (file.text === undefined) return json(failed(file).body, file.status)
  return new Response(file.text, {
    status: 200,
    headers: {
      'Content-Type': file.contentType.startsWith('text/csv') ? file.contentType : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${downloadName(file.disposition, fallbackName)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

const withoutEmpty = (filters) => new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ''))

export const SALES_ROUTES = {
  'GET customer-groups': live(async (ctx) => fromLaravel(await laravelSalesData.listGroups(ctx.token, ctx.request))),
  'POST customer-groups': live(async (ctx) => {
    const { values, errors } = validateGroup(await readBody(ctx.request), { partial: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSalesData.createGroup(ctx.token, values, ctx.request), 201)
  }),
  'PATCH customer-groups/:id': live(async (ctx) => {
    const { values, errors } = validateGroup(await readBody(ctx.request), { partial: true })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSalesData.updateGroup(ctx.token, ctx.id, values, ctx.request))
  }),
  'DELETE customer-groups/:id': live(async (ctx) => fromLaravel(await laravelSalesData.deleteGroup(ctx.token, ctx.id, ctx.request), 200)),

  'GET customers/export.csv': live(async (ctx) => {
    const { q, ...filters } = customerFilters(ctx.url)
    return csvFile(ctx, `/api/admin/v1/customers/export.csv?${withoutEmpty({ search: q, ...filters })}`, 'customers.csv')
  }),
  'POST customers': live(async (ctx) => {
    const { values, errors } = validateCustomer(await readBody(ctx.request), { partial: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSalesData.createCustomer(ctx.token, values, ctx.request), 201)
  }),
  'GET customers/:id': live(async (ctx) => fromLaravel(await laravelSalesData.getCustomer(ctx.token, ctx.id, ctx.request))),
  'DELETE customers/:id': live(async (ctx) => fromLaravel(await laravelSalesData.deleteCustomer(ctx.token, ctx.id, ctx.request), 200)),
  'POST customers/:id/password-reset': live(async (ctx) => fromLaravel(await laravelSalesData.sendPasswordReset(ctx.token, ctx.id, ctx.request), 200)),
  'GET customers/:id/addresses': live(async (ctx) => fromLaravel(await laravelSalesData.listAddresses(ctx.token, ctx.id, ctx.request))),
  'POST customers/:id/addresses': live(async (ctx) => {
    const { values, errors } = validateAddress(await readBody(ctx.request), { partial: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSalesData.createAddress(ctx.token, ctx.id, values, ctx.request), 201)
  }),
  'PATCH customers/:id/addresses/:sub': live(async (ctx) => {
    const { values, errors } = validateAddress(await readBody(ctx.request), { partial: true })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSalesData.updateAddress(ctx.token, ctx.id, ctx.sub, values, ctx.request))
  }),
  'DELETE customers/:id/addresses/:sub': live(async (ctx) => fromLaravel(await laravelSalesData.deleteAddress(ctx.token, ctx.id, ctx.sub, ctx.request), 200)),
  'GET customers/:id/notes': live(async (ctx) => fromLaravel(await laravelSalesData.listNotes(ctx.token, ctx.id, ctx.request))),
  'POST customers/:id/notes': live(async (ctx) => {
    const { body } = await readBody(ctx.request)
    if (!isText(body, { min: 1, max: 2000 })) return invalid({ body: ['Write a note of up to 2000 characters.'] })
    return fromLaravel(await laravelSalesData.addNote(ctx.token, ctx.id, body.trim(), ctx.request), 201)
  }),

  'POST orders/quote': live(async (ctx) => {
    const { values, errors } = validateAdminOrder(await readBody(ctx.request), { quote: true })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSalesData.quoteOrder(ctx.token, values, ctx.request))
  }),
  'POST orders': live(async (ctx) => {
    const { values, errors } = validateAdminOrder(await readBody(ctx.request), { quote: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSalesData.createOrder(ctx.token, values, ctx.request), 201)
  }),
  'POST orders/bulk': live(async (ctx) => {
    const { values, errors } = validateBulkOrders(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSalesData.bulkOrders(ctx.token, values, ctx.request))
  }),
  'GET orders/export.csv': live(async (ctx) => csvFile(ctx, `/api/admin/v1/orders/export.csv?${orderFilters(ctx.url)}`, 'orders.csv')),
  'GET orders/:id/packing-slip': live(async (ctx) => fromLaravel(await laravelSalesData.packingSlip(ctx.token, ctx.id, ctx.request))),
  'POST orders/:id/returns': live(async (ctx) => {
    const { values, errors } = validateReturnCreate(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSalesData.createReturn(ctx.token, ctx.id, values, ctx.request), 201)
  }),

  'GET shipments': live(async (ctx) => {
    const { searchParams } = ctx.url
    const carrier = searchParams.get('carrier')
    const filters = {
      q: searchParams.get('q')?.trim().slice(0, 100) || undefined,
      carrier: CARRIERS.includes(carrier) ? carrier : undefined,
      from: isDay(searchParams.get('from')) ? searchParams.get('from') : undefined,
      to: isDay(searchParams.get('to')) ? searchParams.get('to') : undefined,
      ...pageParams(ctx.url),
    }
    return fromLaravel(await laravelSalesData.listShipments(ctx.token, filters, ctx.request))
  }),
  'GET shipments/:id': live(async (ctx) => fromLaravel(await laravelSalesData.getShipment(ctx.token, ctx.id, ctx.request))),

  'GET returns': live(async (ctx) => {
    const { searchParams } = ctx.url
    const status = searchParams.get('status')
    const filters = { q: searchParams.get('q')?.trim().slice(0, 100) || undefined, status: RETURN_STATUSES.includes(status) ? status : undefined, ...pageParams(ctx.url) }
    return fromLaravel(await laravelSalesData.listReturns(ctx.token, filters, ctx.request))
  }),
  'GET returns/:id': live(async (ctx) => fromLaravel(await laravelSalesData.getReturn(ctx.token, ctx.id, ctx.request))),
  'PATCH returns/:id': live(async (ctx) => {
    const { values, errors } = validateReturnUpdate(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelSalesData.updateReturn(ctx.token, ctx.id, values, ctx.request))
  }),
}

/*
 * The customer list and edit: with Laravel accounts, from the API directly
 * (filters, group, and the full edit); otherwise adminApi.js keeps the
 * accounts backend's demo behaviour.
 */
export const laravelAccounts = () => process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
export async function listCustomersFromLaravel(ctx) {
  return fromLaravel(await laravelSalesData.listCustomers(ctx.token, { ...customerFilters(ctx.url), ...pageParams(ctx.url) }, ctx.request))
}
export async function updateCustomerInLaravel(ctx) {
  const { values, errors } = validateCustomer(await readBody(ctx.request), { partial: true })
  if (errors) return invalid(errors)
  return fromLaravel(await laravelSalesData.updateCustomer(ctx.token, ctx.id, values, ctx.request))
}

/** /api/admin/<resource>/<action> without an id. */
export const SALES_NAMED_ACTIONS = ['orders/quote', 'orders/bulk', 'orders/export.csv', 'customers/export.csv']
/** /api/admin/customers/:id/<part>[/<sub>]: parts of a customer; a sub id only for addresses. */
export const CUSTOMER_PARTS = { addresses: true, notes: false, 'password-reset': false }
export const isShipmentNumber = (value) => /^SHP-\d{1,12}$/.test(value ?? '')
export const isReturnNumber = (value) => /^RMA-\d{1,12}$/.test(value ?? '')
