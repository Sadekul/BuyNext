import { laravel } from '../http.js'
import { camelPath, fromAddress, fromCart, fromLine, fromPayment, fromShipment, fromTotals } from './laravel.js'
import { failed } from './adminSystem.js'
// Phase 11 §4: the customer's points balance.
import { customerPoints } from './adminPhase11.js'
// Phase 12 §1: each order's currency.
import { withCurrency } from './adminPhase12.js'
// Phase 13: the customer's language.
import { customerLocale } from './adminPhase13.js'
// Phase 18: courier bookings on shipments.
import { shipmentPhase18 } from './adminPhase18.js'

/*
 * Phase 6 of the admin (docs/backend/PHASE6_CONTRACT.md) from BuyNest's
 * Laravel admin API: customers (profile, groups, address book, notes),
 * admin-created orders, shipments, returns (RMA), and the order grid's mass
 * actions.
 *
 * Same conventions as shop/admin.js and shop/adminSystem.js: snake_case in,
 * camelCase out, money as numbers for the browser, only listed fields copied
 * either way. A 403 `permission_denied` keeps its code and permission.
 *
 * Each function resolves to { ok: true, status, data } or { ok: false, status, body }.
 */

const money = (value) => (value === null || value === undefined || value === '' ? null : Number(value))
const text = (value) => (typeof value === 'string' ? value : '')
const textOrNull = (value) => (typeof value === 'string' && value !== '' ? value : null)
const int = (value) => (Number.isInteger(value) ? value : null)

// Laravel field names → the admin forms' names (anything else: camelCase path).
const FIELD_NAMES = { group_id: 'groupId', is_active: 'isActive', is_default_shipping: 'isDefaultShipping', is_default_billing: 'isDefaultBilling', customer_id: 'customerId' }
const fieldName = (field) => FIELD_NAMES[field] ?? camelPath(field)
const fail = (result) => failed(result, fieldName)
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : fail(result))
const listOf = (data) => (Array.isArray(data?.data) ? data.data : [])
const paged = (data, key, map, { limit, skip }) => ({ [key]: listOf(data).map(map), total: data?.meta?.total ?? listOf(data).length, limit, skip, live: true })

/** ?page&per_page from the admin's limit/skip, plus any filters that have a value. */
function listParams({ limit = 20, skip = 0, ...filters }) {
  const params = new URLSearchParams({ page: String(Math.floor(skip / limit) + 1), per_page: String(limit) })
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  return params
}

const call = (path, token, request, options = {}) => laravel(`/api/admin/v1${path}`, { token, request, ...options })

// ---- customer groups ----

/** CustomerGroupResource → the admin's group. */
export function customerGroup(raw) {
  return {
    id: raw.id,
    name: text(raw.name),
    code: text(raw.code),
    discountPercent: money(raw.discount_percent) ?? 0,
    isSystem: raw.is_system === true,
    isDefault: raw.is_default === true,
    customerCount: int(raw.customers_count ?? raw.customer_count),
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  }
}
const groupRef = (raw) => (raw && typeof raw === 'object' ? { id: raw.id ?? null, name: text(raw.name), discountPercent: money(raw.discount_percent) ?? 0 } : null)
const toGroupBody = (values) => ({
  ...(values.name !== undefined && { name: values.name }),
  ...(values.code !== undefined && { code: values.code }),
  ...(values.discountPercent !== undefined && { discount_percent: values.discountPercent.toFixed(2) }),
})

// ---- customers ----

/** An address book entry. */
export function customerAddress(raw) {
  return {
    id: raw.id,
    ...fromAddress(raw),
    phone: text(raw.phone),
    company: text(raw.company),
    isDefaultShipping: raw.is_default_shipping === true,
    isDefaultBilling: raw.is_default_billing === true,
  }
}
const ADDRESS_FIELDS = {
  firstName: 'first_name',
  lastName: 'last_name',
  phone: 'phone',
  company: 'company',
  line1: 'line1',
  line2: 'line2',
  city: 'city',
  state: 'state',
  postalCode: 'postal_code',
  country: 'country',
  isDefaultShipping: 'is_default_shipping',
  isDefaultBilling: 'is_default_billing',
  // Phase 14 §2: a Bangladesh address's places (the API fills city and state from them).
  divisionId: 'division_id',
  districtId: 'district_id',
  areaId: 'area_id',
}
const toAddressBody = (values) => Object.fromEntries(Object.entries(values).filter(([field]) => ADDRESS_FIELDS[field]).map(([field, value]) => [ADDRESS_FIELDS[field], value]))

const customerNote = (raw) => ({ id: raw.id, body: text(raw.body), adminName: textOrNull(raw.admin_name ?? raw.admin?.name), createdAt: raw.created_at ?? null })

const orderSummary = (raw) => ({
  number: raw.number,
  status: raw.status,
  paymentStatus: raw.payment_status ?? null,
  source: raw.source ?? null,
  total: money(raw.total ?? raw.totals?.total),
  items: int(raw.item_count ?? raw.items_count ?? raw.totals?.item_count),
  placedAt: raw.placed_at ?? null,
  // Phase 12 §1: the order's own currency.
  ...withCurrency(raw),
})

/** AdminCustomerResource → a row of the customer list (the fields the list always had, plus the group). */
export function customerRow(raw) {
  return {
    id: raw.id,
    firstName: text(raw.first_name),
    lastName: text(raw.last_name),
    email: text(raw.email),
    phone: text(raw.phone),
    emailVerified: raw.email_verified === true || (raw.email_verified_at !== null && raw.email_verified_at !== undefined),
    isActive: raw.is_active !== false,
    group: groupRef(raw.group),
    groupId: raw.group_id ?? raw.group?.id ?? null,
    status: textOrNull(raw.status),
    ordersCount: int(raw.orders_count),
    createdByAdmin: raw.created_by_admin === true,
    createdAt: raw.created_at ?? null,
    lastLoginAt: raw.last_login_at ?? null,
    // Phase 11 §4: the points balance (the grid's optional Points column).
    ...customerPoints(raw),
    // Phase 13: the language of their emails and the store (en | bn; null = the store default).
    ...customerLocale(raw),
  }
}

/** The full profile (GET customers/{id}): account, addresses, order totals, recent orders, notes. */
export function customerProfile(raw) {
  return {
    ...customerRow(raw),
    addresses: (Array.isArray(raw.addresses) ? raw.addresses : []).map(customerAddress),
    ordersCount: int(raw.orders_count) ?? 0,
    lifetimeSpent: money(raw.lifetime_spent) ?? 0,
    recentOrders: (Array.isArray(raw.recent_orders ?? raw.orders) ? (raw.recent_orders ?? raw.orders) : []).map(orderSummary),
    reviewsCount: int(raw.reviews_count) ?? 0,
    notes: (Array.isArray(raw.notes) ? raw.notes : []).map(customerNote),
    live: true,
  }
}
// Phase 13: + locale.
const CUSTOMER_FIELDS = { firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone', groupId: 'group_id', isActive: 'is_active', locale: 'locale' }
const toCustomerBody = (values) => Object.fromEntries(Object.entries(values).filter(([field]) => CUSTOMER_FIELDS[field]).map(([field, value]) => [CUSTOMER_FIELDS[field], value]))

// ---- admin-created orders ----

function toAddress(address) {
  if (!address) return undefined
  // Phase 14 §3: a Bangladesh address's place ids (its zone prices the delivery), when it has them.
  const places = {
    ...(address.divisionId && { division_id: address.divisionId }),
    ...(address.districtId && { district_id: address.districtId }),
    ...(address.areaId && { area_id: address.areaId }),
  }
  // A quote's address: only the country, for tax (and the places).
  if (address.firstName === undefined) return { country: address.country, ...places }
  return {
    ...places,
    first_name: address.firstName,
    last_name: address.lastName,
    line1: address.line1,
    line2: address.line2 || null,
    city: address.city,
    state: address.state || null,
    postal_code: address.postalCode,
    country: address.country,
  }
}

/** The create-order form (validated) → the API's body for quote and POST /orders. */
export function toOrderBody(values) {
  return {
    ...(values.customerId ? { customer_id: values.customerId } : {}),
    ...(values.guest && { guest: { email: values.guest.email, phone: values.guest.phone, first_name: values.guest.firstName, last_name: values.guest.lastName } }),
    items: values.items.map((item) => ({ product_id: item.productId, ...(item.variantId && { variant_id: item.variantId }), quantity: item.quantity })),
    ...(values.shippingAddress && { shipping_address: toAddress(values.shippingAddress) }),
    ...(values.sameAsShipping ? { same_as_shipping: true } : values.billingAddress ? { billing_address: toAddress(values.billingAddress) } : {}),
    ...(values.shippingMethod && { shipping_method: values.shippingMethod }),
    ...(values.paymentMethod && { payment_method: values.paymentMethod }),
    ...(values.couponCode && { coupon_code: values.couponCode }),
    ...(values.note && { note: values.note }),
    notify_customer: values.notifyCustomer,
  }
}

/** The quote: the checkout's priced cart, plus the group discount it used. */
export function orderQuote(raw = {}) {
  const cart = fromCart(raw)
  const group = raw.customer_group && typeof raw.customer_group === 'object' ? raw.customer_group : null
  return {
    ...cart,
    // What the group took off (already inside the subtotal).
    totals: { ...cart.totals, groupDiscount: money(raw.totals?.group_discount) ?? 0 },
    paymentMethods: Array.isArray(raw.payment_methods) ? raw.payment_methods.filter((id) => typeof id === 'string') : null,
    customerGroup: group ? text(group.name) : null,
    groupDiscountPercent: group ? (money(group.discount_percent) ?? 0) : 0,
    live: true,
  }
}

// ---- shipments ----

const slipItem = (raw) => ({ name: text(raw.name), sku: textOrNull(raw.sku), variantLabel: textOrNull(raw.variant_label), quantity: raw.quantity ?? 0 })

/** ShipmentResource (list and detail) → the admin's shipment. */
export function adminShipmentDetail(raw) {
  const order = raw.order && typeof raw.order === 'object' ? raw.order : null
  return {
    ...fromShipment(raw),
    orderNumber: raw.order_number ?? order?.number ?? null,
    adminName: textOrNull(raw.admin_name),
    note: textOrNull(raw.note),
    itemCount: int(raw.item_count ?? raw.items_count) ?? (Array.isArray(raw.items) ? raw.items.reduce((sum, item) => sum + (item.quantity ?? 0), 0) : null),
    ...(Array.isArray(raw.items) && { items: raw.items.map(slipItem) }),
    ...(order && {
      order: {
        number: order.number,
        status: order.status ?? null,
        paymentStatus: order.payment_status ?? null,
        customerName: text(order.customer_name ?? order.customer?.name ?? [order.shipping_address?.first_name, order.shipping_address?.last_name].filter(Boolean).join(' ')),
        email: text(order.email),
        placedAt: order.placed_at ?? null,
        shipTo: textOrNull(order.ship_to),
        phone: textOrNull(order.phone),
        shippingAddress: fromAddress(order.shipping_address) ?? null,
        shippingMethod: order.shipping_method?.label ?? (typeof order.shipping_method === 'string' ? order.shipping_method : null),
      },
    }),
    // Phase 18: the courier booking, delivery status and events (only when the API sent them).
    ...shipmentPhase18(raw),
  }
}

/** Packing slip: what is in the parcel and where it goes. No prices. */
export function packingSlip(raw = {}) {
  const shipTo = raw.ship_to ?? raw.shipping_address
  return {
    orderNumber: raw.order_number ?? raw.number,
    placedAt: raw.placed_at ?? null,
    status: textOrNull(raw.status),
    customerName: text(raw.customer_name ?? [shipTo?.first_name, shipTo?.last_name].filter(Boolean).join(' ')),
    email: text(raw.email),
    phone: text(raw.phone),
    shippingAddress: fromAddress(shipTo) ?? null,
    itemCount: int(raw.item_count),
    shippingMethod: raw.shipping_method?.label ?? (typeof raw.shipping_method === 'string' ? raw.shipping_method : null),
    items: (Array.isArray(raw.items) ? raw.items : []).map(slipItem),
    shipments: (Array.isArray(raw.shipments) ? raw.shipments : []).map((shipment) => ({ number: shipment.number, carrierLabel: shipment.carrier_label ?? shipment.carrier ?? null, trackingNumber: shipment.tracking_number ?? null })),
    storeName: textOrNull(raw.store?.name ?? raw.store_name),
    storeAddress: textOrNull(raw.store?.address ?? raw.store_address),
    storeEmail: textOrNull(raw.store?.support_email),
    storePhone: textOrNull(raw.store?.support_phone),
    live: true,
  }
}

// ---- returns (RMA) ----

const returnItem = (raw) => ({
  id: raw.id,
  orderItemId: raw.order_item_id ?? null,
  name: text(raw.name),
  sku: textOrNull(raw.sku),
  variantLabel: textOrNull(raw.variant_label),
  quantity: raw.quantity ?? 0,
  condition: textOrNull(raw.condition),
})

/** ReturnResource → the admin's return. */
export function adminReturn(raw) {
  const customer = raw.customer && typeof raw.customer === 'object' ? raw.customer : null
  return {
    number: raw.number,
    orderNumber: raw.order_number ?? raw.order?.number ?? null,
    status: raw.status,
    reason: text(raw.reason),
    comment: textOrNull(raw.comment),
    adminNote: textOrNull(raw.admin_note),
    resolution: textOrNull(raw.resolution),
    customer: customer ? { id: customer.id ?? null, name: text(customer.name ?? [customer.first_name, customer.last_name].filter(Boolean).join(' ')), email: text(customer.email) } : null,
    email: text(raw.email ?? raw.order?.email ?? customer?.email),
    items: (Array.isArray(raw.items) ? raw.items : []).map(returnItem),
    itemCount: int(raw.item_count ?? raw.items_count) ?? (Array.isArray(raw.items) ? raw.items.reduce((sum, item) => sum + (item.quantity ?? 0), 0) : 0),
    restocked: raw.restocked === true,
    creditMemoNumber: textOrNull(raw.credit_memo_number ?? raw.credit_memo?.number),
    createdByAdmin: textOrNull(raw.created_by_admin?.name),
    // The moves the server allows from here (never "refunded": that is the credit memo), and whether it can be refunded now.
    allowedTransitions: Array.isArray(raw.allowed_transitions) ? raw.allowed_transitions.filter((status) => typeof status === 'string') : null,
    canRefund: raw.can_refund === true,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
    ...(Array.isArray(raw.history) && {
      history: raw.history.map((entry) => ({ status: entry.status, note: textOrNull(entry.note), adminName: textOrNull(entry.admin_name), createdAt: entry.created_at ?? null })),
    }),
  }
}

const toReturnUpdate = (values) => ({
  status: values.status,
  ...(values.adminNote && { admin_note: values.adminNote }),
  ...(values.resolution && { resolution: values.resolution }),
  ...(values.items && { items: values.items.map((item) => ({ return_item_id: item.returnItemId, condition: item.condition })) }),
  ...(values.restock !== undefined && { restock: values.restock }),
  notify_customer: values.notifyCustomer,
})

const toReturnCreate = (values) => ({
  items: values.items.map((item) => ({ order_item_id: item.orderItemId, quantity: item.quantity })),
  reason: values.reason,
  ...(values.comment && { comment: values.comment }),
  ...(values.resolution && { resolution: values.resolution }),
  ...(values.overrideWindow && { override_window: true }),
  notify_customer: values.notifyCustomer,
})

// ---- the calls ----

export const laravelSalesData = {
  async listGroups(token, request) {
    return answer(await call('/customer-groups', token, request), [200], (data) => ({ groups: listOf(data).map(customerGroup), live: true }))
  },
  async createGroup(token, values, request) {
    return answer(await call('/customer-groups', token, request, { method: 'POST', body: toGroupBody(values) }), [200, 201], (data) => ({ group: customerGroup(data.data), live: true }))
  },
  async updateGroup(token, id, values, request) {
    return answer(await call(`/customer-groups/${id}`, token, request, { method: 'PATCH', body: toGroupBody(values) }), [200], (data) => ({ group: customerGroup(data.data), live: true }))
  },
  async deleteGroup(token, id, request) {
    return answer(await call(`/customer-groups/${id}`, token, request, { method: 'DELETE' }), [200, 204], () => ({ id: Number(id), deleted: true, live: true }))
  },

  async listCustomers(token, filters, request) {
    const { q, ...rest } = filters
    return answer(await call(`/customers?${listParams({ ...rest, search: q })}`, token, request), [200], (data) => ({ ...paged(data, 'customers', customerRow, filters), manageable: true }))
  },
  async getCustomer(token, id, request) {
    return answer(await call(`/customers/${id}`, token, request), [200], (data) => customerProfile(data.data))
  },
  async createCustomer(token, values, request) {
    return answer(await call('/customers', token, request, { method: 'POST', body: toCustomerBody(values) }), [200, 201], (data) => ({ customer: customerRow(data.data), live: true }))
  },
  /** Answers the customer itself (the list's block/unblock reads `isActive` from it). */
  async updateCustomer(token, id, values, request) {
    return answer(await call(`/customers/${id}`, token, request, { method: 'PATCH', body: toCustomerBody(values) }), [200], (data) => customerProfile(data.data))
  },
  async deleteCustomer(token, id, request) {
    return answer(await call(`/customers/${id}`, token, request, { method: 'DELETE' }), [200, 204], () => ({ id: Number(id), deleted: true, live: true }))
  },
  async sendPasswordReset(token, id, request) {
    return answer(await call(`/customers/${id}/password-reset`, token, request, { method: 'POST', body: {} }), [200, 201, 202, 204], (data) => ({
      sent: true,
      message: textOrNull(data?.message) ?? 'A password reset email is on its way.',
    }))
  },

  async listAddresses(token, id, request) {
    return answer(await call(`/customers/${id}/addresses`, token, request), [200], (data) => ({ addresses: listOf(data).map(customerAddress), live: true }))
  },
  async createAddress(token, id, values, request) {
    return answer(await call(`/customers/${id}/addresses`, token, request, { method: 'POST', body: toAddressBody(values) }), [200, 201], (data) => ({ address: customerAddress(data.data), live: true }))
  },
  async updateAddress(token, id, addressId, values, request) {
    return answer(await call(`/customers/${id}/addresses/${addressId}`, token, request, { method: 'PATCH', body: toAddressBody(values) }), [200], (data) => ({ address: customerAddress(data.data), live: true }))
  },
  async deleteAddress(token, id, addressId, request) {
    return answer(await call(`/customers/${id}/addresses/${addressId}`, token, request, { method: 'DELETE' }), [200, 204], () => ({ deleted: true, live: true }))
  },

  async listNotes(token, id, request) {
    return answer(await call(`/customers/${id}/notes`, token, request), [200], (data) => ({ notes: listOf(data).map(customerNote), live: true }))
  },
  async addNote(token, id, body, request) {
    return answer(await call(`/customers/${id}/notes`, token, request, { method: 'POST', body: { body } }), [200, 201], (data) => ({ note: customerNote(data.data), live: true }))
  },

  async quoteOrder(token, values, request) {
    return answer(await call('/orders/quote', token, request, { method: 'POST', body: toOrderBody(values) }), [200], (data) => orderQuote(data.data))
  },
  async createOrder(token, values, request) {
    const result = await call('/orders', token, request, { method: 'POST', body: toOrderBody(values) })
    if ([200, 201].includes(result.status)) {
      const order = result.data?.data ?? {}
      return { ok: true, status: 201, data: { order: { number: order.number, status: order.status, paymentStatus: order.payment_status ?? null, source: order.source ?? 'admin', totals: fromTotals(order.totals), items: (order.items ?? []).map(fromLine), ...(order.payment && { payment: fromPayment(order.payment) }) }, live: true } }
    }
    const failure = fail(result)
    // Lines the server refused (out of stock, variant needed…), like the storefront's checkout.
    if (Array.isArray(result.data?.problems)) failure.body.problems = result.data.problems.map((problem) => ({ productId: problem.product_id ?? null, variantId: problem.variant_id ?? null, code: problem.code, message: problem.message }))
    return failure
  },
  async bulkOrders(token, values, request) {
    const body = { numbers: values.numbers, action: values.action, ...(values.carrier && { carrier: values.carrier }), ...(values.notifyCustomer !== undefined && { notify_customer: values.notifyCustomer }) }
    return answer(await call('/orders/bulk', token, request, { method: 'POST', body }), [200], (data) => ({
      done: (Array.isArray(data?.data?.done) ? data.data.done : []).filter((number) => typeof number === 'string'),
      skipped: (Array.isArray(data?.data?.skipped) ? data.data.skipped : []).map((item) => ({ number: text(item.number), reason: text(item.reason) })),
      live: true,
    }))
  },
  async packingSlip(token, number, request) {
    return answer(await call(`/orders/${number}/packing-slip`, token, request), [200], (data) => packingSlip(data.data))
  },

  async listShipments(token, filters, request) {
    const { q, ...rest } = filters
    return answer(await call(`/shipments?${listParams({ ...rest, search: q })}`, token, request), [200], (data) => paged(data, 'shipments', adminShipmentDetail, filters))
  },
  async getShipment(token, number, request) {
    return answer(await call(`/shipments/${number}`, token, request), [200], (data) => ({ ...adminShipmentDetail(data.data), live: true }))
  },

  async listReturns(token, filters, request) {
    const { q, ...rest } = filters
    return answer(await call(`/returns?${listParams({ ...rest, search: q })}`, token, request), [200], (data) => ({
      ...paged(data, 'returns', adminReturn, filters),
      // How many returns are in each status (all returns, whatever the filters).
      counts: Object.fromEntries(Object.entries(data?.meta?.counts ?? {}).filter(([, count]) => Number.isInteger(count))),
    }))
  },
  async getReturn(token, number, request) {
    return answer(await call(`/returns/${number}`, token, request), [200], (data) => ({ ...adminReturn(data.data), live: true }))
  },
  async updateReturn(token, number, values, request) {
    return answer(await call(`/returns/${number}`, token, request, { method: 'PATCH', body: toReturnUpdate(values) }), [200], (data) => ({ return: adminReturn(data.data), live: true }))
  },
  async createReturn(token, number, values, request) {
    return answer(await call(`/orders/${number}/returns`, token, request, { method: 'POST', body: toReturnCreate(values) }), [200, 201], (data) => ({ return: adminReturn(data.data), live: true }))
  },
}
