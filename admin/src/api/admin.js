import { api } from './client'

/*
 * Admin endpoints (server/adminApi.js in the frontend project). Every one is
 * checked on the server: non-admin accounts get 403 whatever this app shows.
 * Customers are real with BuyNest accounts; products and orders are still
 * DummyJSON demo data, whose writes are simulated (`simulated: true`).
 */

export const adminKeys = {
  overview: ['overview'],
  products: (params) => ['products', params],
  product: (id) => ['product', String(id)],
  categories: ['categories'],
  orders: (params) => ['orders', params],
  order: (id) => ['order', String(id)],
  customers: (params) => ['customers', params],
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
export const getCustomers = (params, { signal } = {}) => api.get('/api/admin/customers', { params, signal })
/** Block (isActive false) or unblock a customer. Blocking signs them out everywhere. BuyNest accounts only. */
export const updateCustomer = (id, values) => api.patch(`/api/admin/customers/${id}`, values)
