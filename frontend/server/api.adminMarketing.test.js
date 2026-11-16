// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

/*
 * Phase 7 admin marketing routes (adminMarketingApi.js, shop/adminMarketing.js):
 * catalog price rules, the cart-rule coupon fields, newsletter subscribers and
 * campaigns, the abandoned carts report, and search terms. Laravel is faked;
 * each call is recorded with its raw body. Shapes from the backend's
 * implementation notes (parts A and B) in docs/backend/PHASE7_CONTRACT.md.
 */

const SITE = 'https://shop.example'
const ME = { id: 1, name: 'Store Admin', email: 'admin@buynest.test', role: { id: 1, name: 'Owner' }, permissions: ['coupons.view'] }

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const entry = { method: init.method ?? 'GET', path: pathname, search, body: init.body }
    calls.push(entry)
    const key = `${entry.method} ${pathname}`
    const found = key === 'GET /api/admin/v1/me' ? { body: { data: ME } } : routes[key]
    const route = typeof found === 'function' ? found(entry) : (found ?? { status: 404, body: { message: 'Not found' } })
    if (typeof route.body === 'string') return new Response(route.body, { status: route.status ?? 200, headers: route.headers })
    return new Response(route.status === 204 ? null : JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

function admin(action, { method = 'GET', body } = {}) {
  return handleApiRequest(
    new Request(`${SITE}/api/admin/${action}`, {
      method,
      headers: { 'Sec-Fetch-Site': 'same-origin', Cookie: 'buynest_admin_at=9|ADMIN', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  )
}
const sent = (entry) => JSON.parse(entry.body)
const toApi = (calls) => calls.filter((entry) => entry.path !== '/api/admin/v1/me')

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const RULE = {
  id: 4, name: 'Winter sale', description: null, is_active: true, status: 'active', starts_at: null, ends_at: '2026-12-31T23:59:59Z',
  customer_group_ids: [2], category_ids: [5], product_ids: [], action: 'percent', amount: '15.00', priority: 1, stop_further: true,
  created_at: '2026-11-17T08:00:00Z', updated_at: '2026-11-17T08:00:00Z', secret: 'never',
}

describe('catalog price rules', () => {
  it('lists with filters, creates (checked, money as a string), and maps the preview', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/catalog-rules': { body: { data: [RULE], meta: { total: 1 } } },
      'POST /api/admin/v1/catalog-rules': { status: 201, body: { data: { ...RULE, id: 9 } } },
      'GET /api/admin/v1/catalog-rules/4/preview': {
        body: { data: [{ product_id: 12, name: 'Mascara', sku: 'BEA-1', thumbnail_url: null, status: 'active', price: '10.00', old_price: '9.00', new_price: '8.50', has_variants: false }], meta: { total: 61 } },
      },
    })
    const list = await (await admin('catalog-rules?q=winter&status=active&evil=1&limit=10')).json()
    expect(toApi(calls)[0].search).toBe('?page=1&per_page=10&status=active&search=winter')
    expect(list.rules[0]).toEqual({
      id: 4, name: 'Winter sale', description: '', isActive: true, status: 'active', startsAt: null, endsAt: '2026-12-31T23:59:59Z',
      customerGroupIds: [2], categoryIds: [5], productIds: [], action: 'percent', amount: 15, priority: 1, stopFurther: true,
      createdAt: '2026-11-17T08:00:00Z', updatedAt: '2026-11-17T08:00:00Z',
    })

    const bad = await admin('catalog-rules', { method: 'POST', body: { name: '', action: 'percent', amount: 150, priority: 5000, productIds: [1, 1] } })
    expect(bad.status).toBe(422)
    expect(Object.keys((await bad.json()).errors).sort()).toEqual(['amount', 'name', 'priority', 'productIds'])
    const backwards = await admin('catalog-rules', { method: 'POST', body: { name: 'X', action: 'fixed', amount: 5, startsAt: '2026-12-02', endsAt: '2026-12-01' } })
    expect((await backwards.json()).errors.endsAt).toEqual(['The end must be after the start.'])

    const created = await admin('catalog-rules', { method: 'POST', body: { name: ' Winter ', action: 'fixed', amount: 2.5, customerGroupIds: [2], isActive: true, stopFurther: false, priority: 0, admin_id: 7 } })
    expect(created.status).toBe(201)
    expect(sent(toApi(calls).at(-1))).toEqual({ name: 'Winter', action: 'fixed', amount: '2.50', customer_group_ids: [2], is_active: true, stop_further: false, priority: 0 })

    expect(await (await admin('catalog-rules/4/preview')).json()).toEqual({
      products: [{ id: 12, name: 'Mascara', sku: 'BEA-1', thumbnail: null, status: 'active', price: 10, oldPrice: 9, newPrice: 8.5, hasVariants: false }],
      total: 61,
      live: true,
    })
  })

  it('updates only what was sent, passes 403 and 404 on, deletes (204), and refuses odd addresses', async () => {
    const calls = fakeLaravel({
      'PATCH /api/admin/v1/catalog-rules/4': { body: { data: { ...RULE, is_active: false } } },
      'DELETE /api/admin/v1/catalog-rules/4': { status: 204 },
      'GET /api/admin/v1/catalog-rules/8': { status: 404, body: { message: 'Catalog price rule not found.' } },
      'POST /api/admin/v1/catalog-rules': { status: 403, body: { message: 'Forbidden.', code: 'permission_denied', permission: 'price_rules.manage' } },
      'PATCH /api/admin/v1/catalog-rules/5': { status: 422, body: { message: 'Invalid.', errors: { 'category_ids.0': ['The selected category is invalid.'] } } },
    })
    expect((await (await admin('catalog-rules/4', { method: 'PATCH', body: { isActive: false } })).json()).rule.isActive).toBe(false)
    expect(sent(toApi(calls).at(-1))).toEqual({ is_active: false })
    expect((await admin('catalog-rules/4', { method: 'PATCH', body: {} })).status).toBe(422)
    expect(await (await admin('catalog-rules/4', { method: 'DELETE' })).json()).toEqual({ id: 4, deleted: true, live: true })
    const missing = await admin('catalog-rules/8')
    expect(missing.status).toBe(404)
    const denied = await admin('catalog-rules', { method: 'POST', body: { name: 'X', action: 'percent', amount: 5 } })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({ message: 'Forbidden.', code: 'permission_denied', permission: 'price_rules.manage' })
    const invalid = await admin('catalog-rules/5', { method: 'PATCH', body: { categoryIds: [99] } })
    expect((await invalid.json()).errors).toEqual({ 'categoryIds.0': ['The selected category is invalid.'] })
    for (const path of ['catalog-rules/abc', 'catalog-rules/4/other', 'catalog-rules/4/preview/x']) expect((await admin(path)).status).toBe(404)
  })

  it('needs the BuyNest backend', async () => {
    vi.stubEnv('VITE_API_PROVIDER', 'dummyjson')
    fakeLaravel({})
    expect((await admin('catalog-rules')).status).toBe(404)
  })
})

describe('coupons as cart price rules', () => {
  const COUPON = {
    id: 3, code: null, description: 'Buy 2 shoes, get 1 free', type: 'buy_x_get_y', value: '0.00', min_subtotal: null, starts_at: null, ends_at: null,
    usage_limit: null, usage_limit_per_customer: 1, times_used: 0, is_active: true, status: 'active', customer_group_ids: [], applies_to: 'categories',
    category_ids: [5], product_ids: [], free_shipping: false, buy_quantity: 2, get_quantity: 1, auto_apply: true,
  }

  it('maps the new fields both ways and checks the rules that span fields', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/coupons': { body: { data: [COUPON], meta: { total: 1 } } },
      'POST /api/admin/v1/coupons': { status: 201, body: { data: COUPON } },
    })
    const list = await (await admin('coupons?kind=automatic')).json()
    expect(toApi(calls)[0].search).toContain('kind=automatic')
    expect(list.coupons[0]).toMatchObject({ code: null, type: 'buy_x_get_y', appliesTo: 'categories', categoryIds: [5], buyQuantity: 2, getQuantity: 1, autoApply: true, freeShipping: false })

    const problems = async (body) => (await (await admin('coupons', { method: 'POST', body })).json()).errors
    expect(await problems({ type: 'percent', value: 10 })).toEqual({ code: ['Enter a code, or make the rule automatic.'] })
    expect(await problems({ code: 'AUTO1', autoApply: true, type: 'percent', value: 10 })).toEqual({ code: ['An automatic rule has no code.'] })
    expect(await problems({ code: 'X10', type: 'percent', value: 10, appliesTo: 'products', productIds: [] })).toEqual({ productIds: ['Choose at least one product.'] })
    expect(await problems({ code: 'X10', type: 'buy_x_get_y', buyQuantity: 2 })).toEqual({ getQuantity: ['Enter how many are free, from 1 to 100.'] })

    const created = await admin('coupons', {
      method: 'POST',
      body: { code: null, autoApply: true, description: '', type: 'buy_x_get_y', value: 5, buyQuantity: 2, getQuantity: 1, appliesTo: 'categories', categoryIds: [5], customerGroupIds: [], freeShipping: false, usageLimitPerCustomer: 1, isActive: true },
    })
    expect(created.status).toBe(201)
    expect(sent(toApi(calls).at(-1))).toEqual({
      code: null, auto_apply: true, description: null, type: 'buy_x_get_y', value: '0.00', buy_quantity: 2, get_quantity: 1, applies_to: 'categories',
      category_ids: [5], customer_group_ids: [], free_shipping: false, usage_limit_per_customer: 1, is_active: true,
    })
  })
})

const SUBSCRIBER = { id: 7, email: 'ava@example.com', status: 'subscribed', source: 'footer', customer: { id: 5, name: 'Ava Stone' }, confirmed_at: '2026-11-17T09:00:00Z', unsubscribed_at: null, created_at: '2026-11-17T08:00:00Z' }
const CAMPAIGN = { id: 2, subject: 'Winter deals', preheader: 'Up to 30% off', body: '<p>Hello</p>', status: 'draft', recipient_count: 0, sent_count: 0, failed_count: 0, created_by: { id: 1, name: 'Store Admin' }, sent_at: null, created_at: '2026-11-17T08:00:00Z' }

describe('newsletter', () => {
  it('lists subscribers with filters and counts, exports CSV, and unsubscribes', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/newsletter/subscribers': { body: { data: [SUBSCRIBER], meta: { total: 1, counts: { pending: 2, subscribed: 1, unsubscribed: 0 } } } },
      'GET /api/admin/v1/newsletter/subscribers/export.csv': (entry) => ({ body: `email\nava@example.com\n${entry.search}`, headers: { 'Content-Type': 'text/csv; charset=UTF-8', 'Content-Disposition': 'attachment; filename="newsletter-subscribers-2026-11-17.csv"' } }),
      'POST /api/admin/v1/newsletter/subscribers/7/unsubscribe': { body: { data: { ...SUBSCRIBER, status: 'unsubscribed', unsubscribed_at: '2026-11-17T10:00:00Z' } } },
    })
    const list = await (await admin('newsletter/subscribers?q=ava&status=subscribed&source=nope')).json()
    expect(toApi(calls)[0].search).toBe('?page=1&per_page=20&status=subscribed&search=ava')
    expect(list).toMatchObject({ total: 1, counts: { pending: 2, subscribed: 1, unsubscribed: 0 } })
    expect(list.subscribers[0]).toEqual({ id: 7, email: 'ava@example.com', customerId: 5, customerName: 'Ava Stone', status: 'subscribed', source: 'footer', confirmedAt: '2026-11-17T09:00:00Z', unsubscribedAt: null, createdAt: '2026-11-17T08:00:00Z' })

    const csv = await admin('newsletter/subscribers/export.csv?status=pending&source=footer&q=ava')
    expect(csv.headers.get('content-disposition')).toBe('attachment; filename="newsletter-subscribers-2026-11-17.csv"')
    expect(await csv.text()).toContain('?search=ava&status=pending&source=footer')

    expect((await (await admin('newsletter/subscribers/7/unsubscribe', { method: 'POST' })).json()).subscriber.status).toBe('unsubscribed')
    for (const [path, method] of [['newsletter/subscribers/7', 'GET'], ['newsletter/other', 'GET'], ['newsletter/campaigns/2/launch', 'POST']]) expect((await admin(path, { method })).status).toBe(404)
  })

  it('creates and edits campaigns (body kept as typed), test-sends, sends, and passes the draft-only guard on', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/newsletter/campaigns': { body: { data: [CAMPAIGN], meta: { total: 1 } } },
      'POST /api/admin/v1/newsletter/campaigns': { status: 201, body: { data: CAMPAIGN } },
      'PATCH /api/admin/v1/newsletter/campaigns/2': { status: 422, body: { message: 'Sent.', errors: { campaign: ["This campaign has already been sent, so it can't be changed."] } } },
      'POST /api/admin/v1/newsletter/campaigns/2/test': { body: { message: 'Test email sent to admin@buynest.test.', data: { email: 'admin@buynest.test' } } },
      'POST /api/admin/v1/newsletter/campaigns/2/send': { status: 202, body: { message: 'Sending.', data: { ...CAMPAIGN, status: 'sent', recipient_count: 3, sent_count: 3, sent_at: '2026-11-17T10:00:00Z' } } },
      'DELETE /api/admin/v1/newsletter/campaigns/2': { status: 204 },
    })
    const list = await (await admin('newsletter/campaigns?status=draft')).json()
    expect(list.campaigns[0]).toMatchObject({ subject: 'Winter deals', status: 'draft', createdByName: 'Store Admin', failedCount: 0 })
    expect(toApi(calls)[0].search).toBe('?page=1&per_page=20&status=draft')

    expect((await admin('newsletter/campaigns', { method: 'POST', body: { subject: 'x'.repeat(151), body: '' } })).status).toBe(422)
    await admin('newsletter/campaigns', { method: 'POST', body: { subject: ' Winter deals ', preheader: '', body: '  <p>Hello</p>\n' } })
    expect(sent(toApi(calls).at(-1))).toEqual({ subject: 'Winter deals', preheader: null, body: '  <p>Hello</p>\n' })

    const locked = await admin('newsletter/campaigns/2', { method: 'PATCH', body: { subject: 'Again' } })
    expect(locked.status).toBe(422)
    expect((await locked.json()).errors.campaign).toEqual(["This campaign has already been sent, so it can't be changed."])

    expect(await (await admin('newsletter/campaigns/2/test', { method: 'POST' })).json()).toEqual({ sent: true, email: 'admin@buynest.test', message: 'Test email sent to admin@buynest.test.' })
    const send = await admin('newsletter/campaigns/2/send', { method: 'POST' })
    expect(send.status).toBe(200)
    expect((await send.json()).campaign).toMatchObject({ status: 'sent', recipientCount: 3, sentCount: 3 })
    expect((await admin('newsletter/campaigns/2', { method: 'DELETE' })).status).toBe(200)
  })
})

describe('reports', () => {
  it('lists abandoned carts with allow-listed filters, and passes the 72-hour limit of a reminder on', async () => {
    const CART = {
      customer: { id: 5, name: 'Ava Stone', email: 'ava@example.com', is_active: true },
      items: [{ product_id: 12, variant_id: null, name: 'Mascara', variant_label: null, sku: 'BEA-1', thumbnail_url: null, quantity: 2, sale_price: '8.94', available: true }],
      item_count: 2, subtotal: '17.88', updated_at: '2026-11-16T08:00:00Z', age_minutes: 1500, reminded_at: null, can_remind: true, remind_available_at: null,
    }
    const calls = fakeLaravel({
      'GET /api/admin/v1/reports/abandoned-carts': { body: { data: [CART], meta: { total: 1 } } },
      'POST /api/admin/v1/reports/abandoned-carts/5/remind': { body: { message: 'Reminder sent to ava@example.com.', data: { customer_id: 5, email: 'ava@example.com', reminded_at: '2026-11-17T10:00:00Z' } } },
      'POST /api/admin/v1/reports/abandoned-carts/6/remind': { status: 429, body: { message: 'This customer was reminded less than 72 hours ago.', code: 'too_soon' } },
    })
    const report = await (await admin('reports/abandoned-carts?minAgeHours=24&maxAgeDays=x&minSubtotal=20.5&sort=subtotal&q=ava')).json()
    expect(toApi(calls)[0].search).toBe('?page=1&per_page=20&min_age_hours=24&min_subtotal=20.50&sort=subtotal&search=ava')
    expect(report.carts[0]).toMatchObject({ customerId: 5, customer: { name: 'Ava Stone' }, subtotal: 17.88, ageMinutes: 1500, canRemind: true, items: [{ name: 'Mascara', quantity: 2, salePrice: 8.94 }] })

    expect(await (await admin('reports/abandoned-carts/5/remind', { method: 'POST' })).json()).toEqual({ reminded: true, email: 'ava@example.com', remindedAt: '2026-11-17T10:00:00Z', message: 'Reminder sent to ava@example.com.' })
    const soon = await admin('reports/abandoned-carts/6/remind', { method: 'POST' })
    expect(soon.status).toBe(429)
    expect((await soon.json()).code).toBe('too_soon')
  })

  it('reports search terms (top or zero results) and edits a term’s redirect', async () => {
    const TERM = { id: 3, term: 'red shoes', hits: 14, last_results_count: 0, redirect_url: null, created_at: '2026-11-17T08:00:00Z', updated_at: '2026-11-17T09:00:00Z' }
    const calls = fakeLaravel({
      'GET /api/admin/v1/reports/search-terms': { body: { data: [TERM], meta: { total: 1 } } },
      'GET /api/admin/v1/search-terms': { body: { data: [{ ...TERM, redirect_url: '/category/shoes' }], meta: { total: 1 } } },
      'PATCH /api/admin/v1/search-terms/3': (entry) => ({ body: { data: { ...TERM, redirect_url: JSON.parse(entry.body).redirect_url } } }),
      'POST /api/admin/v1/search-terms': { status: 201, body: { data: { ...TERM, id: 4, term: 'sale', hits: 0, redirect_url: '/sale' } } },
      'DELETE /api/admin/v1/search-terms/3': { status: 204 },
    })
    const report = await (await admin('reports/search-terms?type=zero&q=red')).json()
    expect(toApi(calls)[0].search).toBe('?page=1&per_page=20&type=zero&search=red')
    expect(report.terms).toEqual([{ id: 3, term: 'red shoes', hits: 14, lastResultsCount: 0, redirectUrl: null, createdAt: '2026-11-17T08:00:00Z', updatedAt: '2026-11-17T09:00:00Z' }])
    await admin('search-terms?hasRedirect=true')
    expect(toApi(calls).at(-1).search).toBe('?page=1&per_page=20&has_redirect=1')

    for (const redirectUrl of ['//evil.example', 'javascript:alert(1)', 'http://plain.example', 'shoes', 12]) {
      expect((await admin('search-terms/3', { method: 'PATCH', body: { redirectUrl } })).status).toBe(422)
    }
    expect((await (await admin('search-terms/3', { method: 'PATCH', body: { redirectUrl: ' /category/shoes ' } })).json()).term.redirectUrl).toBe('/category/shoes')
    expect((await (await admin('search-terms/3', { method: 'PATCH', body: { redirectUrl: 'https://help.example/sizes' } })).json()).term.redirectUrl).toBe('https://help.example/sizes')
    expect((await (await admin('search-terms/3', { method: 'PATCH', body: { redirectUrl: '' } })).json()).term.redirectUrl).toBe(null)
    expect(sent(toApi(calls).at(-1))).toEqual({ redirect_url: null })

    expect((await admin('search-terms', { method: 'POST', body: { term: 'Sale', redirectUrl: '' } })).status).toBe(422)
    expect((await admin('search-terms', { method: 'POST', body: { term: '  Big   SALE ', redirectUrl: '/sale' } })).status).toBe(201)
    expect(sent(toApi(calls).at(-1))).toEqual({ term: 'big sale', redirect_url: '/sale' })
    expect((await admin('search-terms/3', { method: 'DELETE' })).status).toBe(200)
  })
})
