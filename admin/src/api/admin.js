import { api } from './client'

/*
 * Admin endpoints (server/adminApi.js in the frontend project). Every one is
 * checked on the server: non-admin accounts get 403 whatever this app shows.
 * Customers are real with BuyNest accounts. Products and orders are real with
 * the Laravel catalog too (LIVE_DATA, api/mode.js; answers say `live: true`);
 * otherwise they are DummyJSON demo data, whose writes are simulated (`simulated: true`).
 */

export const adminKeys = {
  overview: ['overview'],
  products: (params) => ['products', params],
  product: (id) => ['product', String(id)],
  categories: ['categories'],
  orders: (params) => ['orders', params],
  order: (id) => ['order', String(id)],
  customers: (params) => ['customers', params],
  refundable: (number) => ['refundable', String(number)],
  invoices: (params) => ['invoices', params],
  invoice: (number) => ['invoice', String(number)],
  creditMemos: (params) => ['credit-memos', params],
  creditMemo: (number) => ['credit-memo', String(number)],
  coupons: (params) => ['coupons', params],
  coupon: (id) => ['coupon', String(id)],
}

export const getOverview = ({ signal } = {}) => api.get('/api/admin/overview', { signal })
export const getProducts = (params, { signal } = {}) => api.get('/api/admin/products', { params, signal })
export const getProduct = (id, { signal } = {}) => api.get(`/api/admin/products/${id}`, { signal })
export const createProduct = (values) => api.post('/api/admin/products', values)
export const updateProduct = (id, values) => api.put(`/api/admin/products/${id}`, values)
export const deleteProduct = (id) => api.delete(`/api/admin/products/${id}`)
export const getCategories = ({ signal } = {}) => api.get('/api/admin/categories', { signal })
export const getOrders = (params, { signal } = {}) => api.get('/api/admin/orders', { params, signal })
export const getOrder = (id, { signal } = {}) => api.get(`/api/admin/orders/${id}`, { signal })
/** { status?, paymentStatus: 'paid'?, note?, notifyCustomer? } → the updated order. Real orders only. */
export const updateOrder = (number, changes) => api.patch(`/api/admin/orders/${number}`, changes)
export const getCustomers = (params, { signal } = {}) => api.get('/api/admin/customers', { params, signal })
/** Block (isActive false) or unblock a customer. Blocking signs them out everywhere. BuyNest accounts only. */
export const updateCustomer = (id, values) => api.patch(`/api/admin/customers/${id}`, values)

/*
 * Phase 3 documents (docs/backend/PHASE3_CONTRACT.md), real orders only.
 * An invoice records the payment, a shipment the parcel, a credit memo a refund.
 */
/** { note?, notifyCustomer } → { invoice }. */
export const createInvoice = (number, values) => api.post(`/api/admin/orders/${number}/invoices`, values)
/** { carrier, trackingNumber?, note?, notifyCustomer } → { shipment }. */
export const createShipment = (number, values) => api.post(`/api/admin/orders/${number}/shipments`, values)
/** { items: [{ orderItemId, quantity }], shippingRefund, adjustment, restock, note?, notifyCustomer } → { creditMemo }. */
export const createCreditMemo = (number, values) => api.post(`/api/admin/orders/${number}/credit-memos`, values)
/** What can still be refunded: { items: [{ orderItemId, name, sku, ordered, refunded, refundable, unitRefund }], shippingRefundable, maxTotal }. */
export const getRefundable = (number, { signal } = {}) => api.get(`/api/admin/orders/${number}/refundable`, { signal })
export const getInvoices = (params, { signal } = {}) => api.get('/api/admin/invoices', { params, signal })
export const getInvoice = (number, { signal } = {}) => api.get(`/api/admin/invoices/${number}`, { signal })
export const getCreditMemos = (params, { signal } = {}) => api.get('/api/admin/credit-memos', { params, signal })
export const getCreditMemo = (number, { signal } = {}) => api.get(`/api/admin/credit-memos/${number}`, { signal })
export const getCoupons = (params, { signal } = {}) => api.get('/api/admin/coupons', { params, signal })
export const getCoupon = (id, { signal } = {}) => api.get(`/api/admin/coupons/${id}`, { signal })
export const createCoupon = (values) => api.post('/api/admin/coupons', values)
export const updateCoupon = (id, values) => api.patch(`/api/admin/coupons/${id}`, values)
/** Deletes an unused coupon ({ deleted: true }); one already used is only disabled ({ disabled: true, coupon }). */
export const deleteCoupon = (id) => api.delete(`/api/admin/coupons/${id}`)
