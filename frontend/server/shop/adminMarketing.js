import { laravel } from '../http.js'
import { camelPath } from './laravel.js'
import { failed } from './adminSystem.js'

/*
 * Phase 7 marketing (docs/backend/PHASE7_CONTRACT.md) from BuyNest's Laravel
 * admin API: catalog price rules (and their preview), newsletter subscribers
 * and campaigns, the abandoned carts report (and its reminder), and the
 * search terms report (and each term's redirect).
 *
 * Same conventions as shop/adminSales.js: snake_case in, camelCase out, money
 * as numbers for the browser (2-decimal strings to the API), only listed
 * fields copied either way. A 403 `permission_denied` keeps its code and
 * permission.
 *
 * Each function resolves to { ok: true, status, data } or { ok: false, status, body }.
 */

const money = (value) => (value === null || value === undefined || value === '' ? null : Number(value))
const text = (value) => (typeof value === 'string' ? value : '')
const textOrNull = (value) => (typeof value === 'string' && value !== '' ? value : null)
const int = (value) => (Number.isInteger(value) ? value : Number.isInteger(Number(value)) && value !== null && value !== '' ? Number(value) : null)
const ids = (value) => (Array.isArray(value) ? value.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [])
const cents = (value) => (typeof value === 'number' ? value.toFixed(2) : value)

// Laravel field names → the admin forms' names (anything else: camelCase path, so "product_ids.0" → "productIds.0").
const FIELD_NAMES = { redirect_url: 'redirectUrl', min_subtotal: 'minSubtotal' }
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

// ---- catalog price rules ----

/** CatalogRuleResource → the admin's rule. */
export function catalogRule(raw) {
  return {
    id: raw.id,
    name: text(raw.name),
    description: text(raw.description),
    isActive: raw.is_active === true,
    status: textOrNull(raw.status),
    startsAt: raw.starts_at ?? null,
    endsAt: raw.ends_at ?? null,
    customerGroupIds: ids(raw.customer_group_ids),
    categoryIds: ids(raw.category_ids),
    productIds: ids(raw.product_ids),
    action: raw.action === 'fixed' ? 'fixed' : 'percent',
    amount: money(raw.amount) ?? 0,
    priority: int(raw.priority) ?? 0,
    stopFurther: raw.stop_further === true,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  }
}
const RULE_FIELDS = {
  name: 'name',
  description: 'description',
  isActive: 'is_active',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  customerGroupIds: 'customer_group_ids',
  categoryIds: 'category_ids',
  productIds: 'product_ids',
  action: 'action',
  amount: 'amount',
  priority: 'priority',
  stopFurther: 'stop_further',
}
export const toRuleBody = (values) =>
  Object.fromEntries(Object.entries(values).filter(([field]) => RULE_FIELDS[field]).map(([field, value]) => [RULE_FIELDS[field], field === 'amount' ? cents(value) : value]))

/** One row of a rule's preview: the product, its price now, and with the rule. */
const previewRow = (raw) => ({
  id: raw.product_id ?? raw.id ?? null,
  name: text(raw.name),
  sku: textOrNull(raw.sku),
  thumbnail: textOrNull(raw.thumbnail_url),
  status: textOrNull(raw.status),
  // price = the base price; oldPrice = the product's own sale price; newPrice = with this rule alone.
  price: money(raw.price),
  oldPrice: money(raw.old_price),
  newPrice: money(raw.new_price),
  hasVariants: raw.has_variants === true,
})

// ---- newsletter ----

export function subscriber(raw) {
  const customer = raw.customer && typeof raw.customer === 'object' ? raw.customer : null
  const customerName = customer ? textOrNull(customer.name) ?? textOrNull([customer.first_name, customer.last_name].filter(Boolean).join(' ')) : null
  return {
    id: raw.id,
    email: text(raw.email),
    customerId: raw.customer_id ?? customer?.id ?? null,
    customerName,
    status: text(raw.status),
    source: textOrNull(raw.source),
    confirmedAt: raw.confirmed_at ?? null,
    unsubscribedAt: raw.unsubscribed_at ?? null,
    createdAt: raw.created_at ?? null,
  }
}

export function campaign(raw) {
  const author = raw.created_by && typeof raw.created_by === 'object' ? raw.created_by : null
  return {
    id: raw.id,
    subject: text(raw.subject),
    preheader: text(raw.preheader),
    body: text(raw.body),
    status: text(raw.status) || 'draft',
    sentCount: int(raw.sent_count) ?? 0,
    failedCount: int(raw.failed_count) ?? 0,
    recipientCount: int(raw.recipient_count),
    createdByName: textOrNull(author?.name),
    sentAt: raw.sent_at ?? null,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  }
}
const toCampaignBody = (values) => ({
  ...(values.subject !== undefined && { subject: values.subject }),
  ...(values.preheader !== undefined && { preheader: values.preheader }),
  ...(values.body !== undefined && { body: values.body }),
})

// ---- reports ----

export function abandonedCart(raw) {
  const customer = raw.customer && typeof raw.customer === 'object' ? raw.customer : {}
  return {
    customerId: customer.id ?? raw.customer_id ?? null,
    customer: { id: customer.id ?? raw.customer_id ?? null, name: text(customer.name), email: text(customer.email), isActive: customer.is_active !== false },
    items: (Array.isArray(raw.items) ? raw.items : []).map((item) => ({
      productId: item.product_id ?? null,
      variantId: item.variant_id ?? null,
      name: text(item.name),
      variantLabel: textOrNull(item.variant_label),
      sku: textOrNull(item.sku),
      thumbnail: textOrNull(item.thumbnail_url),
      quantity: int(item.quantity) ?? 0,
      salePrice: money(item.sale_price),
      available: item.available !== false,
    })),
    itemCount: int(raw.item_count) ?? 0,
    subtotal: money(raw.subtotal) ?? 0,
    updatedAt: raw.updated_at ?? null,
    ageMinutes: int(raw.age_minutes),
    remindedAt: raw.reminded_at ?? null,
    // false when the customer is blocked or unverified, or was reminded in the last 72 hours.
    canRemind: raw.can_remind === true,
    remindAvailableAt: raw.remind_available_at ?? null,
  }
}

export function searchTerm(raw) {
  return {
    id: raw.id,
    term: text(raw.term),
    hits: int(raw.hits) ?? 0,
    lastResultsCount: int(raw.last_results_count) ?? 0,
    redirectUrl: textOrNull(raw.redirect_url),
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  }
}

export const laravelMarketingData = {
  async listRules(token, filters, request) {
    const { q, ...rest } = filters
    return answer(await call(`/catalog-rules?${listParams({ ...rest, search: q })}`, token, request), [200], (data) => paged(data, 'rules', catalogRule, filters))
  },
  async getRule(token, id, request) {
    return answer(await call(`/catalog-rules/${id}`, token, request), [200], (data) => ({ ...catalogRule(data.data), live: true }))
  },
  async createRule(token, values, request) {
    return answer(await call('/catalog-rules', token, request, { method: 'POST', body: toRuleBody(values) }), [200, 201], (data) => ({ rule: catalogRule(data.data), live: true }))
  },
  async updateRule(token, id, values, request) {
    return answer(await call(`/catalog-rules/${id}`, token, request, { method: 'PATCH', body: toRuleBody(values) }), [200], (data) => ({ rule: catalogRule(data.data), live: true }))
  },
  async deleteRule(token, id, request) {
    return answer(await call(`/catalog-rules/${id}`, token, request, { method: 'DELETE' }), [200, 204], () => ({ id: Number(id), deleted: true, live: true }))
  },
  async previewRule(token, id, request) {
    return answer(await call(`/catalog-rules/${id}/preview`, token, request), [200], (data) => ({
      products: listOf(data).map(previewRow),
      total: int(data?.meta?.total) ?? listOf(data).length,
      live: true,
    }))
  },

  async listSubscribers(token, filters, request) {
    const { q, ...rest } = filters
    return answer(await call(`/newsletter/subscribers?${listParams({ ...rest, search: q })}`, token, request), [200], (data) => ({
      ...paged(data, 'subscribers', subscriber, filters),
      counts: Object.fromEntries(Object.entries(data?.meta?.counts ?? {}).filter(([, count]) => Number.isInteger(count))),
    }))
  },
  async unsubscribe(token, id, request) {
    return answer(await call(`/newsletter/subscribers/${id}/unsubscribe`, token, request, { method: 'POST', body: {} }), [200], (data) => ({ subscriber: subscriber(data.data), live: true }))
  },

  async listCampaigns(token, filters, request) {
    const { q, ...rest } = filters
    return answer(await call(`/newsletter/campaigns?${listParams({ ...rest, search: q })}`, token, request), [200], (data) => paged(data, 'campaigns', campaign, filters))
  },
  async getCampaign(token, id, request) {
    return answer(await call(`/newsletter/campaigns/${id}`, token, request), [200], (data) => ({ ...campaign(data.data), live: true }))
  },
  async createCampaign(token, values, request) {
    return answer(await call('/newsletter/campaigns', token, request, { method: 'POST', body: toCampaignBody(values) }), [200, 201], (data) => ({ campaign: campaign(data.data), live: true }))
  },
  async updateCampaign(token, id, values, request) {
    return answer(await call(`/newsletter/campaigns/${id}`, token, request, { method: 'PATCH', body: toCampaignBody(values) }), [200], (data) => ({ campaign: campaign(data.data), live: true }))
  },
  async deleteCampaign(token, id, request) {
    return answer(await call(`/newsletter/campaigns/${id}`, token, request, { method: 'DELETE' }), [200, 204], () => ({ id: Number(id), deleted: true, live: true }))
  },
  async testCampaign(token, id, request) {
    return answer(await call(`/newsletter/campaigns/${id}/test`, token, request, { method: 'POST', body: {} }), [200, 201, 202], (data) => ({
      sent: true,
      email: textOrNull(data?.data?.email),
      message: textOrNull(data?.message) ?? 'A test copy is on its way to your email.',
    }))
  },
  async sendCampaign(token, id, request) {
    return answer(await call(`/newsletter/campaigns/${id}/send`, token, request, { method: 'POST', body: {} }), [200, 201, 202], (data) => ({
      campaign: data?.data && typeof data.data === 'object' && data.data.id !== undefined ? campaign(data.data) : null,
      message: textOrNull(data?.message) ?? 'The campaign is on its way to every subscriber.',
      live: true,
    }))
  },

  async abandonedCarts(token, filters, request) {
    const { q, ...rest } = filters
    return answer(await call(`/reports/abandoned-carts?${listParams({ ...rest, search: q })}`, token, request), [200], (data) => paged(data, 'carts', abandonedCart, filters))
  },
  async remindCart(token, customerId, request) {
    return answer(await call(`/reports/abandoned-carts/${customerId}/remind`, token, request, { method: 'POST', body: {} }), [200, 201, 202], (data) => ({
      reminded: true,
      email: textOrNull(data?.data?.email),
      remindedAt: data?.data?.reminded_at ?? null,
      message: textOrNull(data?.message) ?? 'The reminder email is on its way.',
    }))
  },

  async searchTermReport(token, filters, request) {
    const { q, ...rest } = filters
    return answer(await call(`/reports/search-terms?${listParams({ ...rest, search: q })}`, token, request), [200], (data) => paged(data, 'terms', searchTerm, filters))
  },
  async listSearchTerms(token, filters, request) {
    const { q, ...rest } = filters
    return answer(await call(`/search-terms?${listParams({ ...rest, search: q })}`, token, request), [200], (data) => paged(data, 'terms', searchTerm, filters))
  },
  async createSearchTerm(token, values, request) {
    return answer(await call('/search-terms', token, request, { method: 'POST', body: { term: values.term, redirect_url: values.redirectUrl } }), [200, 201], (data) => ({ term: searchTerm(data.data), live: true }))
  },
  async updateSearchTerm(token, id, values, request) {
    return answer(await call(`/search-terms/${id}`, token, request, { method: 'PATCH', body: { redirect_url: values.redirectUrl } }), [200], (data) => ({ term: searchTerm(data.data), live: true }))
  },
  async deleteSearchTerm(token, id, request) {
    return answer(await call(`/search-terms/${id}`, token, request, { method: 'DELETE' }), [200, 204], () => ({ id: Number(id), deleted: true, live: true }))
  },
}
