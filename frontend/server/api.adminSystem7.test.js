// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

/*
 * Phase 7 admin routes, system part (adminContentApi.js, shop/adminContent.js):
 * email templates, URL redirects, the dashboard's new blocks, notifications,
 * grid preferences, and product SEO fields. Laravel is faked; each call is
 * recorded with its raw body. Shapes from "Implementation notes — part B" in
 * docs/backend/PHASE7_CONTRACT.md.
 */

const SITE = 'https://shop.example'
const ME = { id: 1, name: 'Store Admin', email: 'admin@buynest.test', role: { id: 1, name: 'Owner' }, permissions: ['email_templates.manage', 'seo.manage'] }

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const entry = { method: init.method ?? 'GET', path: pathname, search, headers: init.headers ?? {}, body: init.body }
    calls.push(entry)
    const key = `${entry.method} ${pathname}`
    const found = key === 'GET /api/admin/v1/me' ? { body: { data: ME } } : routes[key]
    const route = typeof found === 'function' ? found(entry) : (found ?? { status: 404, body: { message: 'Not found' } })
    return new Response(route.status === 204 ? null : JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

function admin(action, { method = 'GET', body, headers = {}, raw } = {}) {
  return handleApiRequest(
    new Request(`${SITE}/api/admin/${action}`, {
      method,
      headers: { 'Sec-Fetch-Site': 'same-origin', Cookie: 'buynest_admin_at=9|ADMIN', ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
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

const SUMMARY = { key: 'email_verification', name: 'Email verification code', description: 'Sent when a customer signs up.', subject: 'Your BuyNest code', is_customized: false, updated_at: null, updated_by: null }
const DETAIL = {
  ...SUMMARY,
  body: '<p>Your code is {{ code }}</p>',
  default_subject: 'Your BuyNest code',
  default_body: '<p>Your code is {{ code }}</p>',
  variables: [
    { name: 'customer_first_name', label: 'First name', kind: 'text', required: false },
    { name: 'code', label: 'The 6-digit code', kind: 'text', required: true },
    { name: 'button', label: 'A button', kind: 'block', required: false },
  ],
  required: [['code']],
}

describe('email templates', () => {
  it('lists and opens templates, with variables and required groups', async () => {
    fakeLaravel({
      'GET /api/admin/v1/email-templates': { body: { data: [SUMMARY, { ...SUMMARY, key: 'invoice', name: 'Invoice', is_customized: true, updated_at: '2026-11-17T10:00:00Z', updated_by: { id: 1, name: 'Store Admin' } }] } },
      'GET /api/admin/v1/email-templates/email_verification': { body: { data: DETAIL } },
    })
    const list = await (await admin('email-templates')).json()
    expect(list.templates[1]).toEqual({ key: 'invoice', name: 'Invoice', description: 'Sent when a customer signs up.', subject: 'Your BuyNest code', isCustomized: true, updatedAt: '2026-11-17T10:00:00Z', updatedBy: 'Store Admin' })
    const detail = await (await admin('email-templates/email_verification')).json()
    expect(detail).toMatchObject({ key: 'email_verification', body: '<p>Your code is {{ code }}</p>', defaultSubject: 'Your BuyNest code', requiredGroups: [['code']], live: true })
    expect(detail.variables).toEqual([
      { name: 'customer_first_name', description: 'First name', kind: 'text', required: false },
      { name: 'code', description: 'The 6-digit code', kind: 'text', required: true },
      { name: 'button', description: 'A button', kind: 'block', required: false },
    ])
  })

  it('saves (checked first), previews, test-sends and resets; passes the 422 on', async () => {
    const calls = fakeLaravel({
      'PUT /api/admin/v1/email-templates/email_verification': (entry) =>
        sent(entry).body.includes('{{ foo }}')
          ? { status: 422, body: { message: 'Invalid.', errors: { body: ['Unknown variable {{ foo }}. Use only the variables listed for this template.'] } } }
          : { body: { data: { ...DETAIL, subject: 'Hi', is_customized: true, updated_at: '2026-11-17T10:00:00Z' } } },
      'POST /api/admin/v1/email-templates/email_verification/preview': { body: { data: { subject: 'Hi', html: '<!doctype html><p>Your code is 123456</p>', text: 'Your code is 123456' } } },
      'POST /api/admin/v1/email-templates/email_verification/test': { body: { message: 'Test email sent to admin@buynest.test.', data: { email: 'admin@buynest.test' } } },
      'POST /api/admin/v1/email-templates/email_verification/reset': { body: { data: DETAIL } },
    })
    expect((await admin('email-templates/email_verification', { method: 'PUT', body: { subject: '  ', body: '<p>x</p>' } })).status).toBe(422)
    expect(toApi(calls)).toHaveLength(0)

    const saved = await admin('email-templates/email_verification', { method: 'PUT', body: { subject: ' Hi ', body: '<p>{{ code }}</p>', isCustomized: false } })
    expect(saved.status).toBe(200)
    expect(sent(toApi(calls).at(-1))).toEqual({ subject: 'Hi', body: '<p>{{ code }}</p>' })
    expect((await saved.json()).template).toMatchObject({ subject: 'Hi', isCustomized: true })

    const refused = await admin('email-templates/email_verification', { method: 'PUT', body: { subject: 'Hi', body: '<p>{{ foo }}</p>' } })
    expect(refused.status).toBe(422)
    expect((await refused.json()).errors).toEqual({ body: ['Unknown variable {{ foo }}. Use only the variables listed for this template.'] })

    const preview = await admin('email-templates/email_verification/preview', { method: 'POST', body: { body: '<p>{{ code }}</p>' } })
    expect(await preview.json()).toEqual({ subject: 'Hi', html: '<!doctype html><p>Your code is 123456</p>', text: 'Your code is 123456' })
    expect(sent(toApi(calls).at(-1))).toEqual({ body: '<p>{{ code }}</p>' })

    expect(await (await admin('email-templates/email_verification/test', { method: 'POST', body: {} })).json()).toEqual({ sent: true, to: 'admin@buynest.test', message: 'Test email sent to admin@buynest.test.' })
    const reset = await admin('email-templates/email_verification/reset', { method: 'POST', body: {} })
    expect((await reset.json()).template).toMatchObject({ isCustomized: false })
  })

  it('refuses malformed keys and unknown actions before calling the API', async () => {
    const calls = fakeLaravel({})
    for (const path of ['email-templates/Bad-Key', 'email-templates/email_verification/send', 'email-templates/x/preview/extra']) expect((await admin(path)).status).toBe(404)
    expect(toApi(calls)).toHaveLength(0)
  })
})

const REDIRECT = { id: 4, from_path: '/old-sale', to_path: '/deals', status_code: 301, hits: 12, created_at: '2026-11-17T10:00:00Z', updated_at: '2026-11-17T10:00:00Z' }

describe('URL redirects', () => {
  it('lists with search and paging, creates (checked), updates, and deletes', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/redirects': { body: { data: [REDIRECT], meta: { total: 1 } } },
      'POST /api/admin/v1/redirects': { status: 201, body: { data: { ...REDIRECT, id: 5, from_path: '/products/12', to_path: '/categories/beauty', status_code: 302 } } },
      'PATCH /api/admin/v1/redirects/4': { body: { data: { ...REDIRECT, to_path: 'https://blog.example/sale' } } },
      'DELETE /api/admin/v1/redirects/4': { status: 204 },
    })
    expect(await (await admin('redirects?q=sale&statusCode=301&limit=50&skip=50')).json()).toEqual({
      redirects: [{ id: 4, fromPath: '/old-sale', toPath: '/deals', statusCode: 301, hits: 12, createdAt: '2026-11-17T10:00:00Z', updatedAt: '2026-11-17T10:00:00Z' }],
      total: 1,
      limit: 50,
      skip: 50,
      live: true,
    })
    expect(Object.fromEntries(new URLSearchParams(toApi(calls).at(-1).search))).toEqual({ page: '2', per_page: '50', search: 'sale', status_code: '301' })

    for (const body of [{ fromPath: 'old', toPath: '/x' }, { fromPath: '/a?b=1', toPath: '/x' }, { fromPath: '/a', toPath: 'http://insecure.example' }, { fromPath: '/a', toPath: '//evil.example' }, { fromPath: '/a', toPath: '/a' }, { fromPath: '/a', toPath: '/b', statusCode: 307 }]) {
      expect((await admin('redirects', { method: 'POST', body })).status).toBe(422)
    }
    expect(toApi(calls)).toHaveLength(1)

    const created = await admin('redirects', { method: 'POST', body: { fromPath: ' /products/12 ', toPath: '/categories/beauty', statusCode: 302, hits: 99 } })
    expect(created.status).toBe(201)
    expect(sent(toApi(calls).at(-1))).toEqual({ from_path: '/products/12', to_path: '/categories/beauty', status_code: 302 })
    expect((await created.json()).redirect).toMatchObject({ id: 5, fromPath: '/products/12', statusCode: 302 })

    await admin('redirects/4', { method: 'PATCH', body: { toPath: 'https://blog.example/sale' } })
    expect(sent(toApi(calls).at(-1))).toEqual({ to_path: 'https://blog.example/sale' })
    expect(await (await admin('redirects/4', { method: 'DELETE' })).json()).toEqual({ id: 4, deleted: true, live: true })
  })

  it('passes a duplicate path 422 on with the form field names', async () => {
    fakeLaravel({ 'POST /api/admin/v1/redirects': { status: 422, body: { message: 'Invalid.', errors: { from_path: ['A redirect from this path already exists.'] } } } })
    const refused = await admin('redirects', { method: 'POST', body: { fromPath: '/old-sale', toPath: '/deals' } })
    expect((await refused.json()).errors).toEqual({ fromPath: ['A redirect from this path already exists.'] })
  })

  it('imports a CSV as multipart and maps the report', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/redirects/import': { body: { data: { created: 2, updated: 1, errors: [{ line: 4, message: 'to_path: Enter a store path.' }] } } },
    })
    const form = new FormData()
    form.append('file', new Blob(['from_path,to_path\n/a,/b\n'], { type: 'text/csv' }), 'redirects.csv')
    const request = new Request(`${SITE}/api/admin/redirects/import`, { method: 'POST', body: form })
    const response = await admin('redirects/import', { method: 'POST', headers: { 'Content-Type': request.headers.get('content-type') }, raw: await request.arrayBuffer() })
    expect(await response.json()).toEqual({ created: 2, updated: 1, skipped: 1, errors: [{ row: 4, message: 'to_path: Enter a store path.' }], live: true })
    expect(toApi(calls).at(-1).headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/)
    expect((await admin('redirects/import', { method: 'POST', body: { file: 'x' } })).status).toBe(422)
  })
})

describe('notifications', () => {
  const NOTE = { id: 7, type: 'low_stock', severity: 'warning', title: 'Mascara is low on stock', body: '3 left.', link: '/products/1', created_at: '2026-11-17T10:00:00Z', read_at: null }

  it('lists with the unread count, marks one and all read', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/notifications': { body: { data: [NOTE, { ...NOTE, id: 8, severity: 'loud', link: 'https://evil.example', read_at: '2026-11-17T11:00:00Z' }], meta: { total: 2, unread_count: 1 } } },
      'POST /api/admin/v1/notifications/7/read': { body: { data: { ...NOTE, read_at: '2026-11-17T12:00:00Z' } } },
      'POST /api/admin/v1/notifications/read-all': { body: { data: { marked: 3 }, meta: { unread_count: 0 } } },
    })
    const list = await (await admin('notifications?unread=1&limit=500')).json()
    expect(list).toEqual({
      notifications: [
        { id: 7, type: 'low_stock', severity: 'warning', title: 'Mascara is low on stock', body: '3 left.', link: '/products/1', createdAt: '2026-11-17T10:00:00Z', readAt: null },
        { id: 8, type: 'low_stock', severity: 'info', title: 'Mascara is low on stock', body: '3 left.', link: null, createdAt: '2026-11-17T10:00:00Z', readAt: '2026-11-17T11:00:00Z' },
      ],
      unreadCount: 1,
      total: 2,
      live: true,
    })
    expect(Object.fromEntries(new URLSearchParams(toApi(calls).at(-1).search))).toEqual({ page: '1', per_page: '50', unread: '1' })
    expect((await (await admin('notifications/7/read', { method: 'POST', body: {} })).json()).notification.readAt).toBe('2026-11-17T12:00:00Z')
    expect(await (await admin('notifications/read-all', { method: 'POST', body: {} })).json()).toEqual({ marked: 3, unreadCount: 0, live: true })
    expect((await admin('notifications/abc/read', { method: 'POST', body: {} })).status).toBe(404)
  })
})

describe('grid preferences', () => {
  it('reads, saves the whole value in the API names, and refuses bad shapes and keys', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/preferences/products_grid': { body: { data: { key: 'products_grid', value: null, updated_at: null } } },
      'PUT /api/admin/v1/preferences/products_grid': (entry) => ({ body: { data: { key: 'products_grid', value: sent(entry).value, updated_at: '2026-11-17T10:00:00Z' } } }),
    })
    expect(await (await admin('preferences/products_grid')).json()).toEqual({ key: 'products_grid', columns: null, pageSize: null, sort: null, direction: null, filters: [], updatedAt: null, live: true })

    const value = { columns: ['product', 'price'], pageSize: 50, filters: [{ name: ' Low stock ', query: { status: 'active', sortBy: 'stock' } }], secret: 'dropped' }
    const saved = await admin('preferences/products_grid', { method: 'PUT', body: value })
    expect(sent(toApi(calls).at(-1))).toEqual({ value: { columns: ['product', 'price'], page_size: 50, filters: [{ name: 'Low stock', params: { status: 'active', sortBy: 'stock' } }] } })
    expect(await saved.json()).toMatchObject({ columns: ['product', 'price'], pageSize: 50, filters: [{ name: 'Low stock', query: { status: 'active', sortBy: 'stock' } }] })

    for (const body of [{ pageSize: 30 }, { columns: 'all' }, { filters: [{ name: '', query: {} }] }, { filters: [{ name: 'a', query: { q: { nested: true } } }] }, { filters: [{ name: 'A', query: {} }, { name: 'a', query: {} }] }]) {
      expect((await admin('preferences/products_grid', { method: 'PUT', body })).status).toBe(422)
    }
    expect((await admin('preferences/settings')).status).toBe(404)
    expect(toApi(calls)).toHaveLength(2)
  })
})

describe('dashboard and product SEO', () => {
  it('maps the new overview blocks and leaves out those the role lacks', async () => {
    fakeLaravel({
      'GET /api/admin/v1/overview': {
        body: {
          data: {
            blocks: ['orders', 'latest_orders', 'revenue_chart', 'bestsellers', 'top_search_terms'],
            orders: { total: 3, revenue: '120.00', units_sold: 5, average_order: '40.00', by_status: {} },
            latest_orders: [],
            revenue_chart: [{ date: '2026-11-17', orders: 2, revenue: '80.50' }],
            bestsellers: [{ product_id: 1, name: 'Mascara', sku: 'MAS-1', units: 4, revenue: '39.96' }],
            top_search_terms: [{ term: 'lipstick', hits: 9, last_results_count: 0 }],
            todo: { orders_to_invoice: 2, orders_to_ship: 1 },
            low_stock_threshold: 5,
          },
        },
      },
    })
    const overview = await (await admin('overview')).json()
    expect(overview).toMatchObject({
      products: null,
      customers: null,
      lowStockProducts: null,
      newCustomers: null,
      orders: { total: 3, revenue: 120, averageOrder: 40 },
      revenueChart: [{ date: '2026-11-17', orders: 2, revenue: 80.5 }],
      bestsellers: [{ productId: 1, name: 'Mascara', sku: 'MAS-1', units: 4, revenue: 39.96 }],
      topSearchTerms: [{ term: 'lipstick', hits: 9, results: 0 }],
      todo: { ordersToInvoice: 2, ordersToShip: 1 },
    })
  })

  it('sends and reads the product meta fields (blank = null)', async () => {
    const PRODUCT = { id: 1, name: 'Mascara', category: { slug: 'beauty' }, price: '9.99', discount_percent: 0, stock_quantity: 9, status: 'active', meta_title: 'Best mascara', meta_description: null }
    const calls = fakeLaravel({ 'PATCH /api/admin/v1/products/1': { body: { data: PRODUCT } } })
    const saved = await admin('products/1', { method: 'PUT', body: { metaTitle: ' Best mascara ', metaDescription: '' } })
    expect(sent(toApi(calls).at(-1))).toEqual({ meta_title: 'Best mascara', meta_description: null })
    expect((await saved.json()).product).toMatchObject({ metaTitle: 'Best mascara', metaDescription: '' })
    expect((await admin('products/1', { method: 'PUT', body: { metaTitle: 'x'.repeat(191) } })).status).toBe(422)
  })
})

describe('without the BuyNest backend', () => {
  it('answers 404 with a plain message', async () => {
    vi.stubEnv('VITE_API_PROVIDER', 'dummyjson')
    fakeLaravel({})
    const response = await admin('email-templates')
    expect(response.status).toBe(404)
    expect((await response.json()).message).toMatch(/needs the BuyNest backend/)
  })
})
