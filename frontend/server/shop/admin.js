import { laravel } from '../http.js'
import { camelPath, fromOrder } from './laravel.js'

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
}
const FORM_FIELD = Object.fromEntries(Object.entries(PRODUCT_FIELDS).map(([form, api]) => [api, form]))
const ORDER_FIELDS = { payment_status: 'paymentStatus', notify_customer: 'notifyCustomer' }
// The admin's sort names → the API's.
const PRODUCT_SORT = { title: 'name', price: 'price', stock: 'stock', rating: 'rating', newest: 'newest' }

function failed({ status, data }, fieldNames = {}) {
  const body = { message: data?.message ?? 'The request failed.' }
  if (data?.errors && typeof data.errors === 'object') {
    body.errors = Object.fromEntries(Object.entries(data.errors).map(([field, messages]) => [fieldNames[field] ?? camelPath(field), messages]))
  }
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
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  }
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
      sku: item.sku,
      title: item.name,
      thumbnail: item.thumbnail_url ?? null,
      price: money(item.sale_price),
      listPrice: money(item.price),
      discountPercentage: Number(item.discount_percent ?? 0),
      quantity: item.quantity,
      total: money(item.price) * item.quantity,
      discountedTotal: money(item.line_total),
    })),
    subtotal: order.totals.subtotal,
    total: order.totals.total,
    items: order.totals.itemCount,
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

const pageOf = ({ limit, skip }) => ({ page: Math.floor(skip / limit) + 1, perPage: limit })

export const laravelAdminData = {
  async overview(token, request) {
    const result = await laravel('/api/admin/v1/overview', { token, request })
    return answer(result, [200], ({ data }) => ({
      products: {
        total: data.products.total,
        active: data.products.active,
        outOfStock: data.products.out_of_stock,
        lowStock: data.products.low_stock,
        inventoryValue: money(data.products.inventory_value),
      },
      orders: {
        total: data.orders.total,
        revenue: money(data.orders.revenue),
        unitsSold: data.orders.units_sold,
        averageOrder: money(data.orders.average_order),
        byStatus: data.orders.by_status ?? {},
      },
      customers: { total: data.customers.total },
      lowStockProducts: (data.low_stock_products ?? []).map((product) => ({
        id: product.id,
        title: product.name,
        sku: product.sku,
        category: typeof product.category === 'object' ? product.category?.slug : product.category,
        stock: product.stock_quantity,
        thumbnail: product.thumbnail_url,
      })),
      latestOrders: (data.latest_orders ?? []).map((order) => ({
        id: order.number,
        number: order.number,
        customer: order.customer_name || order.email,
        email: order.email,
        items: order.items,
        total: money(order.total),
        status: order.status,
        placedAt: order.placed_at,
      })),
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

  async categories(token, request) {
    const result = await laravel('/api/admin/v1/categories', { token, request })
    return answer(result, [200], (data) => data.data.map((category) => ({ id: category.id, slug: category.slug, name: category.name, productCount: category.product_count })))
  },

  async listOrders(token, { q, status, paymentStatus, limit, skip }, request) {
    const { page, perPage } = pageOf({ limit, skip })
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) })
    if (q) params.set('search', q)
    if (status) params.set('status', status)
    if (paymentStatus) params.set('payment_status', paymentStatus)
    const result = await laravel(`/api/admin/v1/orders?${params}`, { token, request })
    return answer(result, [200], (data) => ({ orders: data.data.map(adminOrderRow), total: data.meta?.total ?? data.data.length, limit, skip, live: true }))
  },

  async getOrder(token, number, request) {
    return answer(await laravel(`/api/admin/v1/orders/${number}`, { token, request }), [200], (data) => adminOrderDetail(data.data))
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
