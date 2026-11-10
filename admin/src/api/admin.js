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
  admins: (params) => ['admins', params],
  roles: ['roles'],
  permissions: ['permissions'],
  audit: (params) => ['audit', params],
  pages: (params) => ['pages', params],
  page: (id) => ['page', String(id)],
  home: ['home'],
  report: (name, params) => ['report', name, params],
  settings: ['settings'],
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

/*
 * Phase 4 (docs/backend/PHASE4_CONTRACT.md), BuyNest's backend only. Each
 * needs a permission of the admin's role; without it the server answers 403
 * with `code: 'permission_denied'` and the permission (ApiError.code/.permission).
 */
/** admins.manage: { admins: [{ id, name, email, role: { id, name }, roleId, isActive, lastLoginAt }], total }. */
export const getAdmins = (params, { signal } = {}) => api.get('/api/admin/admins', { params, signal })
/** { name, email, roleId, isActive, password } → { admin }. */
export const createAdmin = (values) => api.post('/api/admin/admins', values)
/** { name?, email?, roleId?, isActive? } → { admin }. Deactivating signs them out everywhere. */
export const updateAdmin = (id, values) => api.patch(`/api/admin/admins/${id}`, values)
/** Sets a new password and signs that admin out everywhere. */
export const resetAdminPassword = (id, password) => api.post(`/api/admin/admins/${id}/reset-password`, { password })
/** { roles: [{ id, name, description, permissions, isSystem, adminCount }] }. */
export const getRoles = ({ signal } = {}) => api.get('/api/admin/roles', { signal })
export const createRole = (values) => api.post('/api/admin/roles', values)
export const updateRole = (id, values) => api.patch(`/api/admin/roles/${id}`, values)
export const deleteRole = (id) => api.delete(`/api/admin/roles/${id}`)
/** { groups: [{ label, permissions: [{ key, label }] }] } for the role form. */
export const getPermissions = ({ signal } = {}) => api.get('/api/admin/permissions', { signal })
/** audit.view: ?adminId&action&from&to&limit&skip → { entries: [{ adminName, action, summary, changes: [{ field, before, after }], ip, createdAt }], total }. */
export const getAudit = (params, { signal } = {}) => api.get('/api/admin/audit', { params, signal })
/** content.view / content.edit. A saved page's `body` is the server's sanitized HTML. */
export const getPages = (params, { signal } = {}) => api.get('/api/admin/pages', { params, signal })
export const getPage = (id, { signal } = {}) => api.get(`/api/admin/pages/${id}`, { signal })
export const createPage = (values) => api.post('/api/admin/pages', values)
export const updatePage = (id, values) => api.patch(`/api/admin/pages/${id}`, values)
export const deletePage = (id) => api.delete(`/api/admin/pages/${id}`)
/** { hero, banners, featuredProductIds, featuredProducts }. */
export const getHome = ({ signal } = {}) => api.get('/api/admin/home', { signal })
export const updateHome = (values) => api.put('/api/admin/home', values)
/** reports.view: name = sales | products | customers | coupons | low-stock; params { from, to, groupBy, limit }. */
export const getReport = (name, params, { signal } = {}) => api.get(`/api/admin/reports/${name}`, { params, signal })
/** The CSV download's address (sales, products); the browser sends the session cookie. */
export function reportCsvUrl(name, params) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value))
  return `/api/admin/reports/${name}.csv${query.size > 0 ? `?${query}` : ''}`
}
/** settings.view / settings.edit: { general, shipping, tax, checkout, inventory }; PATCH one or more groups. */
export const getSettings = ({ signal } = {}) => api.get('/api/admin/settings', { signal })
export const updateSettings = (changes) => api.patch('/api/admin/settings', changes)
