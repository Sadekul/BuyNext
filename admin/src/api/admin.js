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
  reviews: (params) => ['reviews', params],
  customer: (id) => ['customer', String(id)],
  customerGroups: ['customer-groups'],
  shipments: (params) => ['shipments', params],
  shipment: (number) => ['shipment', String(number)],
  returns: (params) => ['returns', params],
  return: (number) => ['return', String(number)],
  packingSlip: (number) => ['packing-slip', String(number)],
  quote: (body) => ['quote', body],
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
/** Phase 8: the Stripe payment link of an unpaid card order (the open one, or a new one) → { payment: { url, expiresAt, error? }, order }. */
export const createPaymentLink = (number) => api.post(`/api/admin/orders/${number}/payment-link`, {})
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

/*
 * Phase 5 (docs/backend/PHASE5_CONTRACT.md), BuyNest's backend only:
 * Magento-style catalog management. Permissions: products.view to read,
 * categories.edit, products.edit, products.delete, products.import,
 * reviews.view, reviews.moderate to change.
 */
const UPLOAD_TIMEOUT = 120_000
/** categories.edit: { name, slug, parentId?, isActive?, description?, metaTitle?, metaDescription?, imageUrl? } → { category }. */
export const createCategory = (values) => api.post('/api/admin/categories', values)
export const updateCategory = (id, values) => api.patch(`/api/admin/categories/${id}`, values)
/** 422 with the server's message when it still has subcategories or products. */
export const deleteCategory = (id) => api.delete(`/api/admin/categories/${id}`)
/** Siblings in their new order: { parentId (null = top level), ids }. */
export const reorderCategories = (parentId, ids) => api.post('/api/admin/categories/reorder', { parentId, ids })

/** products.edit: uploads 1–10 files (JPEG, PNG, WebP; 5 MB each) → { images: [{ id, url, alt, position }] }. */
export function uploadProductImages(productId, files) {
  const form = new FormData()
  for (const file of files) form.append('images[]', file)
  return api.post(`/api/admin/products/${productId}/images`, form, { timeout: UPLOAD_TIMEOUT })
}
export const updateProductImage = (productId, imageId, alt) => api.patch(`/api/admin/products/${productId}/images/${imageId}`, { alt })
/** Phase 16: the option value the image is shown for (null = every choice) → { images }. */
export const updateProductImageChoice = (productId, imageId, optionValueId) => api.patch(`/api/admin/products/${productId}/images/${imageId}`, { optionValueId })
export const deleteProductImage = (productId, imageId) => api.delete(`/api/admin/products/${productId}/images/${imageId}`)
export const reorderProductImages = (productId, ids) => api.post(`/api/admin/products/${productId}/images/reorder`, { ids })
/**
 * { options: [{ name, values: [text] }] } replaces the options; variants without their values are deactivated.
 * Phase 16: + type (text | color) and, for color, values as [{ value, swatch: '#RRGGBB' }].
 */
export const saveProductOptions = (productId, options) => api.put(`/api/admin/products/${productId}/options`, { options })
/** Creates the missing combinations (inactive, stock 0). */
export const generateVariants = (productId) => api.post(`/api/admin/products/${productId}/variants/generate`, {})
/** { sku?, price? (null = the product's price), stock?, isActive? } → { variant }. */
export const updateVariant = (productId, variantId, values) => api.patch(`/api/admin/products/${productId}/variants/${variantId}`, values)

/**
 * Mass action on up to 200 products, all or nothing: { ids, action, value? } →
 * { updated, skipped: [{ id, reason }] }. Actions: enable, disable, archive,
 * delete (products.delete), set_category (category id), adjust_price
 * ({ mode: 'percent' | 'fixed', amount }), set_stock (units).
 */
export const bulkProducts = (ids, action, value) => api.post('/api/admin/products/bulk', { ids, action, ...(value !== undefined && { value }) })

/** products.import: the CSV download's address, with the product list's filters. */
export function productsCsvUrl({ q, category, status } = {}) {
  const query = new URLSearchParams(Object.entries({ q, category, status }).filter(([, value]) => value))
  return `/api/admin/products/export.csv${query.size > 0 ? `?${query}` : ''}`
}
/** Checks (dryRun) or imports a CSV → { dryRun, rows, created, updated, unchanged, errors: [{ row, column, message }] }. */
export function importProducts(file, { dryRun }) {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/api/admin/products/import?dryRun=${dryRun ? 'true' : 'false'}`, form, { timeout: UPLOAD_TIMEOUT })
}

/** reviews.view: ?status&productId&rating&q&limit&skip → { reviews, total }. */
export const getReviews = (params, { signal } = {}) => api.get('/api/admin/reviews', { params, signal })
/** reviews.moderate: status = approved | rejected | pending. */
export const updateReview = (id, status) => api.patch(`/api/admin/reviews/${id}`, { status })
export const bulkReviews = (ids, status) => api.post('/api/admin/reviews/bulk', { ids, status })
export const deleteReview = (id) => api.delete(`/api/admin/reviews/${id}`)

/*
 * Phase 6 (docs/backend/PHASE6_CONTRACT.md), BuyNest's backend only:
 * Magento-style customers and sales. Permissions: customers.view/edit/create/
 * delete, customer_groups.manage, orders.create, returns.view/manage (and the
 * phase 3 ones for the order grid's mass actions).
 */
/** customers.view: { groups: [{ id, name, code, discountPercent, isSystem, customerCount }] }. */
export const getCustomerGroups = ({ signal } = {}) => api.get('/api/admin/customer-groups', { signal })
/** customer_groups.manage: { name, code, discountPercent } → { group }. */
export const createCustomerGroup = (values) => api.post('/api/admin/customer-groups', values)
export const updateCustomerGroup = (id, values) => api.patch(`/api/admin/customer-groups/${id}`, values)
/** 422 with the server's message while customers are in the group (or for the system group). */
export const deleteCustomerGroup = (id) => api.delete(`/api/admin/customer-groups/${id}`)

/** The customer's full profile: account, group, addresses, ordersCount, lifetimeSpent, recentOrders, reviewsCount, notes. */
export const getCustomer = (id, { signal } = {}) => api.get(`/api/admin/customers/${id}`, { signal })
/** customers.create: { firstName, lastName, email, phone?, groupId? } → { customer }. The customer is emailed a "set your password" code. */
export const createCustomer = (values) => api.post('/api/admin/customers', values)
/** customers.delete: refused (422) while the customer has an open order. Orders and reviews are kept. */
export const deleteCustomer = (id) => api.delete(`/api/admin/customers/${id}`)
/** customers.edit: emails the customer a password reset code. Admins never see or set passwords. */
export const sendCustomerPasswordReset = (id) => api.post(`/api/admin/customers/${id}/password-reset`, {})
export const getCustomerAddresses = (id, { signal } = {}) => api.get(`/api/admin/customers/${id}/addresses`, { signal })
export const createCustomerAddress = (id, values) => api.post(`/api/admin/customers/${id}/addresses`, values)
export const updateCustomerAddress = (id, addressId, values) => api.patch(`/api/admin/customers/${id}/addresses/${addressId}`, values)
export const deleteCustomerAddress = (id, addressId) => api.delete(`/api/admin/customers/${id}/addresses/${addressId}`)
export const getCustomerNotes = (id, { signal } = {}) => api.get(`/api/admin/customers/${id}/notes`, { signal })
/** Internal: never shown to the customer. */
export const addCustomerNote = (id, body) => api.post(`/api/admin/customers/${id}/notes`, { body })
/** customers.view: the CSV download's address, with the list's filters. */
export function customersCsvUrl(filters = {}) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value))
  return `/api/admin/customers/export.csv${query.size > 0 ? `?${query}` : ''}`
}

/**
 * orders.create: the order an admin places for a customer (or a guest):
 * { customerId | guest, items: [{ productId, variantId?, quantity }], shippingAddress,
 *   billingAddress | sameAsShipping, shippingMethod, paymentMethod, couponCode?, note?, notifyCustomer }.
 * quoteOrder prices it without placing it (lines, problems, totals, shippingOptions, coupon, couponError).
 */
export const quoteOrder = (body, { signal } = {}) => api.post('/api/admin/orders/quote', body, { signal })
export const createOrder = (body) => api.post('/api/admin/orders', body)
/** { numbers, action: invoice | ship | cancel, carrier?, notifyCustomer } → { done: [numbers], skipped: [{ number, reason }] }. */
export const bulkOrders = (numbers, action, extra = {}) => api.post('/api/admin/orders/bulk', { numbers, action, ...extra })
/** orders.view: the CSV download's address, with the grid's filters. */
export function ordersCsvUrl(filters = {}) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value))
  return `/api/admin/orders/export.csv${query.size > 0 ? `?${query}` : ''}`
}
/** { orderNumber, placedAt, customerName, shippingAddress, shippingMethod, items: [{ name, sku, variantLabel, quantity }] }: no prices. */
export const getPackingSlip = (number, { signal } = {}) => api.get(`/api/admin/orders/${number}/packing-slip`, { signal })
/** returns.manage: { items: [{ orderItemId, quantity }], reason, comment?, overrideWindow?, notifyCustomer } → { return }. */
export const createReturn = (number, values) => api.post(`/api/admin/orders/${number}/returns`, values)

/** orders.view: ?q&carrier&from&to&limit&skip → { shipments, total }. */
export const getShipments = (params, { signal } = {}) => api.get('/api/admin/shipments', { params, signal })
export const getShipment = (number, { signal } = {}) => api.get(`/api/admin/shipments/${number}`, { signal })

/** returns.view: ?status&q&limit&skip → { returns, total }. */
export const getReturns = (params, { signal } = {}) => api.get('/api/admin/returns', { params, signal })
export const getReturn = (number, { signal } = {}) => api.get(`/api/admin/returns/${number}`, { signal })
/** returns.manage: { status, adminNote?, notifyCustomer, items?: [{ returnItemId, condition }], restock? } → { return }. */
export const updateReturn = (number, values) => api.patch(`/api/admin/returns/${number}`, values)

/*
 * ---- Phase 7, system part (docs/backend/PHASE7_CONTRACT.md §4, §5, §7) ----
 * Email templates (email_templates.manage), URL redirects (seo.manage),
 * header notifications (no permission: filtered by the server), and each
 * admin's own grid preferences. BuyNest's backend only.
 */
export const systemKeys = {
  emailTemplates: ['email-templates'],
  emailTemplate: (key) => ['email-template', key],
  redirects: (params) => ['redirects', params],
  notifications: ['notifications'],
  preferences: (key) => ['preferences', key],
}
/** { templates: [{ key, name, description, subject, isCustomized, updatedAt }] }. */
export const getEmailTemplates = ({ signal } = {}) => api.get('/api/admin/email-templates', { signal })
/** The template + { body, defaultSubject, defaultBody, variables: [{ name, description, kind: text | block, required }], requiredGroups: [[names]] }. */
export const getEmailTemplate = (key, { signal } = {}) => api.get(`/api/admin/email-templates/${key}`, { signal })
/** { subject, body } → { template }. 422 for unknown variables or a missing required one. */
export const updateEmailTemplate = (key, values) => api.put(`/api/admin/email-templates/${key}`, values)
/** The draft { subject, body } rendered with sample data → { subject, html }. Nothing is saved. */
export const previewEmailTemplate = (key, values, { signal } = {}) => api.post(`/api/admin/email-templates/${key}/preview`, values, { signal })
/** Sends the draft, with sample data, to the signed-in admin's own email → { sent, to, message }. */
export const testEmailTemplate = (key, values) => api.post(`/api/admin/email-templates/${key}/test`, values)
/** Deletes the customization → { template } (the default again). */
export const resetEmailTemplate = (key) => api.post(`/api/admin/email-templates/${key}/reset`, {})

/** ?q&limit&skip → { redirects: [{ id, fromPath, toPath, statusCode, hits, createdAt, updatedAt }], total }. */
export const getRedirects = (params, { signal } = {}) => api.get('/api/admin/redirects', { params, signal })
/** { fromPath, toPath, statusCode: 301 | 302 } → { redirect }. */
export const createRedirect = (values) => api.post('/api/admin/redirects', values)
export const updateRedirect = (id, values) => api.patch(`/api/admin/redirects/${id}`, values)
export const deleteRedirect = (id) => api.delete(`/api/admin/redirects/${id}`)
/** A CSV of from_path,to_path[,status_code] → { created, updated, skipped, errors: [{ row, message }] }. */
export function importRedirects(file) {
  const form = new FormData()
  form.append('file', file)
  return api.post('/api/admin/redirects/import', form, { timeout: UPLOAD_TIMEOUT })
}

/** { notifications: [{ id, type, severity, title, body, link, createdAt, readAt }], unreadCount }. */
export const getNotifications = (params, { signal } = {}) => api.get('/api/admin/notifications', { params, signal })
export const markNotificationRead = (id) => api.post(`/api/admin/notifications/${id}/read`, {})
export const markAllNotificationsRead = () => api.post('/api/admin/notifications/read-all', {})

/** The admin's own grid settings: { key, columns: [ids] | null, pageSize | null, sort, direction, filters: [{ name, query }] }; PUT replaces them all. */
export const getPreferences = (key, { signal } = {}) => api.get(`/api/admin/preferences/${key}`, { signal })
export const savePreferences = (key, value) => api.put(`/api/admin/preferences/${key}`, value)
/* ---- end of phase 7, system part ---- */
