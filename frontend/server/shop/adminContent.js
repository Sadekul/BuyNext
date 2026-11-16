import { laravel, laravelMultipart } from '../http.js'
import { failed } from './adminSystem.js'

/*
 * Phase 7 of the admin, system part (docs/backend/PHASE7_CONTRACT.md §4, §5,
 * §7 and "Implementation notes — part B"), from BuyNest's Laravel admin API:
 * email templates, URL redirects, the dashboard's new blocks, the header
 * notifications, and each admin's grid preferences.
 *
 * Same conventions as shop/adminSystem.js: snake_case in, camelCase out,
 * money as numbers for the browser, only listed fields copied either way.
 * Each call resolves to { ok: true, status, data } or { ok: false, status, body }.
 */

const money = (value) => (value === null || value === undefined || value === '' ? null : Number(value))
const text = (value) => (typeof value === 'string' ? value : '')
const listOf = (data) => (Array.isArray(data?.data) ? data.data : [])

// Laravel field names → the admin forms' names.
const FIELD_NAMES = { from_path: 'fromPath', to_path: 'toPath', status_code: 'statusCode', page_size: 'pageSize' }
const fieldName = (field) => FIELD_NAMES[field] ?? field.replace(/^value\./, '').replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : failed(result, fieldName))

// ---- email templates ----

const adminRef = (raw) => (raw && typeof raw === 'object' ? text(raw.name) || null : null)

/** A list item (and the start of the detail). */
export function emailTemplateSummary(raw) {
  return {
    key: raw.key,
    name: text(raw.name) || raw.key,
    description: text(raw.description),
    subject: text(raw.subject),
    isCustomized: raw.is_customized === true,
    updatedAt: raw.updated_at ?? null,
    updatedBy: adminRef(raw.updated_by),
  }
}

/** The detail: the list item + body, defaults, and the variables to choose from. */
export function emailTemplate(raw) {
  const variables = (Array.isArray(raw.variables) ? raw.variables : [])
    .filter((variable) => variable && typeof variable.name === 'string')
    .map((variable) => ({ name: variable.name, description: text(variable.label), kind: variable.kind === 'block' ? 'block' : 'text', required: variable.required === true }))
  const requiredGroups = (Array.isArray(raw.required) ? raw.required : [])
    .map((group) => (Array.isArray(group) ? group.filter((name) => typeof name === 'string') : []))
    .filter((group) => group.length > 0)
  return {
    ...emailTemplateSummary(raw),
    body: text(raw.body),
    defaultSubject: text(raw.default_subject),
    defaultBody: text(raw.default_body),
    variables,
    requiredGroups,
  }
}

// ---- redirects ----

export function urlRedirect(raw) {
  return {
    id: raw.id,
    fromPath: text(raw.from_path),
    toPath: text(raw.to_path),
    statusCode: raw.status_code === 302 ? 302 : 301,
    hits: raw.hits ?? 0,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  }
}
const REDIRECT_FIELDS = { fromPath: 'from_path', toPath: 'to_path', statusCode: 'status_code' }
const toBody = (values, fields) => Object.fromEntries(Object.entries(values).filter(([field]) => fields[field]).map(([field, value]) => [fields[field], value]))

/** The import's report: rows with problems are skipped and listed. */
export function redirectImport(raw = {}) {
  const errors = (Array.isArray(raw.errors) ? raw.errors : []).slice(0, 200).map((error) => ({ row: error.line ?? error.row ?? null, message: text(error.message) }))
  return { created: raw.created ?? 0, updated: raw.updated ?? 0, skipped: errors.length, errors }
}

// ---- notifications ----

const SEVERITIES = ['info', 'warning', 'critical']
export function adminNotification(raw) {
  return {
    id: raw.id,
    type: text(raw.type),
    severity: SEVERITIES.includes(raw.severity) ? raw.severity : 'info',
    title: text(raw.title),
    body: text(raw.body),
    // An admin app path only (e.g. /products/12); anything else is dropped.
    link: typeof raw.link === 'string' && /^\/(?!\/)[^\s]*$/.test(raw.link) ? raw.link : null,
    createdAt: raw.created_at ?? null,
    readAt: raw.read_at ?? null,
  }
}

// ---- grid preferences ----

/** { key, value } → the grid's settings in the app's names; no value = the defaults. */
export function gridPreferences(raw = {}) {
  const value = raw.value && typeof raw.value === 'object' ? raw.value : {}
  return {
    key: raw.key,
    columns: Array.isArray(value.columns) ? value.columns.filter((id) => typeof id === 'string') : null,
    pageSize: Number.isInteger(value.page_size) ? value.page_size : null,
    sort: typeof value.sort === 'string' ? value.sort : null,
    direction: value.direction === 'asc' || value.direction === 'desc' ? value.direction : null,
    filters: (Array.isArray(value.filters) ? value.filters : [])
      .filter((filter) => filter && typeof filter.name === 'string')
      .map((filter) => ({ name: filter.name, query: filter.params && typeof filter.params === 'object' && !Array.isArray(filter.params) ? filter.params : {} })),
    updatedAt: raw.updated_at ?? null,
  }
}

/** Validated app values → the API's `value` (only what's set; null columns = every column). */
export function toPreferencesValue({ columns, pageSize, sort, direction, filters }) {
  return {
    ...(columns && { columns }),
    ...(pageSize && { page_size: pageSize }),
    ...(sort && { sort }),
    ...(direction && { direction }),
    ...(filters && { filters: filters.map((filter) => ({ name: filter.name, params: filter.query })) }),
  }
}

// ---- dashboard (the phase 7 blocks of GET /overview) ----

/**
 * The new dashboard blocks, each only when the API included it (the admin
 * has its permission): absent → null (or, for todo, the count left out).
 */
export function dashboardBlocks(data = {}) {
  const todoRaw = data.todo && typeof data.todo === 'object' ? data.todo : {}
  const TODO = { orders_to_invoice: 'ordersToInvoice', orders_to_ship: 'ordersToShip', return_requests: 'returnRequests', pending_reviews: 'pendingReviews', low_stock_products: 'lowStockProducts' }
  return {
    blocks: Array.isArray(data.blocks) ? data.blocks.filter((block) => typeof block === 'string') : null,
    revenueChart: Array.isArray(data.revenue_chart) ? data.revenue_chart.map((point) => ({ date: point.date, orders: point.orders ?? 0, revenue: money(point.revenue) ?? 0 })) : null,
    bestsellers: Array.isArray(data.bestsellers)
      ? data.bestsellers.map((row) => ({ productId: row.product_id ?? null, name: text(row.name), sku: row.sku ?? null, units: row.units ?? 0, revenue: money(row.revenue) ?? 0 }))
      : null,
    newCustomers: Array.isArray(data.new_customers) ? data.new_customers.map((row) => ({ id: row.id, name: text(row.name), email: text(row.email), createdAt: row.created_at ?? null })) : null,
    topSearchTerms: Array.isArray(data.top_search_terms) ? data.top_search_terms.map((row) => ({ term: text(row.term), hits: row.hits ?? 0, results: row.last_results_count ?? null })) : null,
    todo: Object.fromEntries(Object.entries(TODO).filter(([key]) => Number.isInteger(todoRaw[key])).map(([key, name]) => [name, todoRaw[key]])),
  }
}

// ---- the calls ----

const call = (path, token, request, options = {}) => laravel(`/api/admin/v1${path}`, { token, request, ...options })
const listParams = ({ limit = 20, skip = 0, ...filters }) => {
  const params = new URLSearchParams({ page: String(Math.floor(skip / limit) + 1), per_page: String(limit) })
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  return params
}

export const laravelContentData = {
  async listEmailTemplates(token, request) {
    return answer(await call('/email-templates', token, request), [200], (data) => ({ templates: listOf(data).map(emailTemplateSummary), live: true }))
  },
  async getEmailTemplate(token, key, request) {
    return answer(await call(`/email-templates/${key}`, token, request), [200], (data) => ({ ...emailTemplate(data.data), live: true }))
  },
  async updateEmailTemplate(token, key, values, request) {
    return answer(await call(`/email-templates/${key}`, token, request, { method: 'PUT', body: values }), [200], (data) => ({ template: emailTemplate(data.data), live: true }))
  },
  async previewEmailTemplate(token, key, values, request) {
    return answer(await call(`/email-templates/${key}/preview`, token, request, { method: 'POST', body: values }), [200], (data) => ({
      subject: text(data?.data?.subject),
      html: text(data?.data?.html),
      text: text(data?.data?.text),
    }))
  },
  async testEmailTemplate(token, key, values, request) {
    return answer(await call(`/email-templates/${key}/test`, token, request, { method: 'POST', body: values }), [200, 202], (data) => ({
      sent: true,
      to: data?.data?.email ?? null,
      message: text(data?.message),
    }))
  },
  async resetEmailTemplate(token, key, request) {
    return answer(await call(`/email-templates/${key}/reset`, token, request, { method: 'POST', body: {} }), [200], (data) => ({ template: emailTemplate(data.data), live: true }))
  },

  async listRedirects(token, filters, request) {
    const { q, statusCode, ...rest } = filters
    return answer(await call(`/redirects?${listParams({ ...rest, search: q, status_code: statusCode })}`, token, request), [200], (data) => ({
      redirects: listOf(data).map(urlRedirect),
      total: data?.meta?.total ?? listOf(data).length,
      limit: filters.limit,
      skip: filters.skip,
      live: true,
    }))
  },
  async createRedirect(token, values, request) {
    return answer(await call('/redirects', token, request, { method: 'POST', body: toBody(values, REDIRECT_FIELDS) }), [200, 201], (data) => ({ redirect: urlRedirect(data.data), live: true }))
  },
  async updateRedirect(token, id, values, request) {
    return answer(await call(`/redirects/${id}`, token, request, { method: 'PATCH', body: toBody(values, REDIRECT_FIELDS) }), [200], (data) => ({ redirect: urlRedirect(data.data), live: true }))
  },
  async deleteRedirect(token, id, request) {
    return answer(await call(`/redirects/${id}`, token, request, { method: 'DELETE' }), [200, 204], () => ({ id: Number(id), deleted: true, live: true }))
  },
  async importRedirects(token, { contentType, bytes }, request) {
    const result = await laravelMultipart('/api/admin/v1/redirects/import', { token, request, contentType, bytes })
    return answer(result, [200, 201], (data) => ({ ...redirectImport(data?.data), live: true }))
  },

  async listNotifications(token, filters, request) {
    const { unread, ...rest } = filters
    return answer(await call(`/notifications?${listParams({ ...rest, unread: unread ? 1 : undefined })}`, token, request), [200], (data) => ({
      notifications: listOf(data).map(adminNotification),
      unreadCount: data?.meta?.unread_count ?? 0,
      total: data?.meta?.total ?? listOf(data).length,
      live: true,
    }))
  },
  async readNotification(token, id, request) {
    return answer(await call(`/notifications/${id}/read`, token, request, { method: 'POST', body: {} }), [200], (data) => ({ notification: adminNotification(data.data), live: true }))
  },
  async readAllNotifications(token, request) {
    return answer(await call('/notifications/read-all', token, request, { method: 'POST', body: {} }), [200], (data) => ({ marked: data?.data?.marked ?? 0, unreadCount: data?.meta?.unread_count ?? 0, live: true }))
  },

  async getPreferences(token, key, request) {
    return answer(await call(`/preferences/${key}`, token, request), [200], (data) => ({ ...gridPreferences(data?.data), live: true }))
  },
  async savePreferences(token, key, values, request) {
    const result = await call(`/preferences/${key}`, token, request, { method: 'PUT', body: { value: toPreferencesValue(values) } })
    return answer(result, [200], (data) => ({ ...gridPreferences(data?.data), live: true }))
  },
}
