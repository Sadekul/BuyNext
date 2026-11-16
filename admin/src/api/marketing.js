import { api } from './client'

/*
 * Phase 7 marketing (docs/backend/PHASE7_CONTRACT.md), BuyNest's backend only:
 * catalog price rules, newsletter subscribers and campaigns, abandoned carts,
 * and search terms (server/adminMarketingApi.js in the frontend project).
 * Permissions: coupons.view to read price rules, price_rules.manage to change
 * them; newsletter.view / newsletter.send; reports.view; seo.manage for a
 * search term's redirect. Without one, the server answers 403
 * permission_denied (ApiError.code/.permission). Coupons stay in api/admin.js.
 */

export const marketingKeys = {
  rules: (params) => ['catalog-rules', params],
  rule: (id) => ['catalog-rule', String(id)],
  rulePreview: (id) => ['catalog-rule-preview', String(id)],
  subscribers: (params) => ['newsletter-subscribers', params],
  campaigns: (params) => ['newsletter-campaigns', params],
  campaign: (id) => ['newsletter-campaign', String(id)],
  abandonedCarts: (params) => ['abandoned-carts', params],
  searchTerms: (params) => ['search-terms', params],
}

const csvUrl = (path, filters) => {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value))
  return `${path}${query.size > 0 ? `?${query}` : ''}`
}

/** ?q&status&limit&skip → { rules: [{ id, name, isActive, status, startsAt, endsAt, customerGroupIds, categoryIds, productIds, action, amount, priority, stopFurther }], total }. */
export const getCatalogRules = (params, { signal } = {}) => api.get('/api/admin/catalog-rules', { params, signal })
export const getCatalogRule = (id, { signal } = {}) => api.get(`/api/admin/catalog-rules/${id}`, { signal })
export const createCatalogRule = (values) => api.post('/api/admin/catalog-rules', values)
export const updateCatalogRule = (id, values) => api.patch(`/api/admin/catalog-rules/${id}`, values)
export const deleteCatalogRule = (id) => api.delete(`/api/admin/catalog-rules/${id}`)
/** The first 50 products the saved rule matches: { products: [{ id, name, sku, price, oldPrice, newPrice }], total }. */
export const getCatalogRulePreview = (id, { signal } = {}) => api.get(`/api/admin/catalog-rules/${id}/preview`, { signal })

/** newsletter.view: ?q&status&source&limit&skip → { subscribers, total, counts: { pending, subscribed, unsubscribed } }. */
export const getSubscribers = (params, { signal } = {}) => api.get('/api/admin/newsletter/subscribers', { params, signal })
export const subscribersCsvUrl = (filters = {}) => csvUrl('/api/admin/newsletter/subscribers/export.csv', filters)
/** newsletter.send. */
export const unsubscribeSubscriber = (id) => api.post(`/api/admin/newsletter/subscribers/${id}/unsubscribe`, {})

/** newsletter.view: ?q&status&limit&skip → { campaigns: [{ id, subject, status, recipientCount, sentCount, failedCount, sentAt }], total }. */
export const getCampaigns = (params, { signal } = {}) => api.get('/api/admin/newsletter/campaigns', { params, signal })
export const getCampaign = (id, { signal } = {}) => api.get(`/api/admin/newsletter/campaigns/${id}`, { signal })
/** newsletter.send, drafts only: { subject, preheader, body } → { campaign } (body sanitized by the server). */
export const createCampaign = (values) => api.post('/api/admin/newsletter/campaigns', values)
export const updateCampaign = (id, values) => api.patch(`/api/admin/newsletter/campaigns/${id}`, values)
export const deleteCampaign = (id) => api.delete(`/api/admin/newsletter/campaigns/${id}`)
/** A copy to the signed-in admin's own email → { sent, email, message }. */
export const testCampaign = (id) => api.post(`/api/admin/newsletter/campaigns/${id}/test`, {})
/** To every subscribed address → { campaign, message }. */
export const sendCampaign = (id) => api.post(`/api/admin/newsletter/campaigns/${id}/send`, {})

/** reports.view: ?q&minAgeHours&maxAgeDays&minSubtotal&sort&limit&skip → { carts, total }. */
export const getAbandonedCarts = (params, { signal } = {}) => api.get('/api/admin/reports/abandoned-carts', { params, signal })
/** newsletter.send: at most once per 72 hours per cart (429 code "too_soon"). */
export const remindAbandonedCart = (customerId) => api.post(`/api/admin/reports/abandoned-carts/${customerId}/remind`, {})

/** reports.view: ?type=top|zero&q&limit&skip → { terms: [{ id, term, hits, lastResultsCount, redirectUrl, updatedAt }], total }. */
export const getSearchTermReport = (params, { signal } = {}) => api.get('/api/admin/reports/search-terms', { params, signal })
/** seo.manage: ?q&hasRedirect&limit&skip → { terms, total }. */
export const getSearchTerms = (params, { signal } = {}) => api.get('/api/admin/search-terms', { params, signal })
/** seo.manage: { term, redirectUrl } → { term }. */
export const createSearchTerm = (values) => api.post('/api/admin/search-terms', values)
/** seo.manage: redirectUrl "/path", "https://…", or null to remove it. */
export const updateSearchTerm = (id, redirectUrl) => api.patch(`/api/admin/search-terms/${id}`, { redirectUrl })
export const deleteSearchTerm = (id) => api.delete(`/api/admin/search-terms/${id}`)
