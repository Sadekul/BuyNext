// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

// Phase 17 (docs/backend/PHASE17_CONTRACT.md §1.2): the "Deliver to" estimate through the public catalog.
const SITE = 'https://shop.example'

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    calls.push({ path: pathname, search, init })
    const route = routes[`${init.method ?? 'GET'} ${pathname}`] ?? { status: 404, body: { message: 'Not found' } }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}
const SAME = { 'Sec-Fetch-Site': 'same-origin', Origin: SITE }
const request = (path, { method = 'GET' } = {}) => handleApiRequest(new Request(`${SITE}${path}`, { method, headers: SAME }))

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
  vi.stubEnv('BUYNEST_BFF_KEY', 'shared-secret')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('delivery estimate (public catalog)', () => {
  const ESTIMATE = {
    area: { id: 1001, name: 'Banani', district: 'Dhaka', district_id: 47, division: 'Dhaka', division_id: 3 },
    zone: { code: 'inside_dhaka', name: 'Inside Dhaka' },
    methods: [{ id: 'standard', label: 'Standard', price: '60.00', eta: 'Delivery in 1–2 days', eta_days_min: 1, eta_days_max: 2, free_over_threshold: true }],
    free_shipping_threshold: '5000.00',
    cod: { available: true, reason: null, message: null, fee: '0.00' },
  }

  it('forwards a numeric area id only, in the page’s language, documented keys only, cached ten minutes', async () => {
    const calls = fakeLaravel({ 'GET /api/v1/delivery/estimate': { body: { data: { ...ESTIMATE, internal: 'x' } } } })
    const response = await request('/api/catalog/delivery/estimate?area_id=1001&lang=bn&evil=1')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=600')
    expect((await response.json()).data).toEqual(ESTIMATE)
    expect(`${calls[0].path}${calls[0].search}`).toBe('/api/v1/delivery/estimate?area_id=1001')
    expect(calls[0].init.headers['Accept-Language']).toBe('bn')
  })

  it('refuses anything else without asking the API; passes the API’s 422 on', async () => {
    const calls = fakeLaravel({ 'GET /api/v1/delivery/estimate': { status: 422, body: { message: 'Delivery areas are for Bangladesh addresses.', errors: { area_id: ['Delivery areas are for Bangladesh addresses.'] } } } })
    for (const path of ['/api/catalog/delivery/estimate', '/api/catalog/delivery/estimate?area_id=abc', '/api/catalog/delivery/estimate?area_id=-1', '/api/catalog/delivery/zones', '/api/catalog/delivery/estimate/1']) {
      expect((await request(path)).status, path).toBe(404)
    }
    expect(calls).toHaveLength(0)
    expect((await request('/api/catalog/delivery/estimate?area_id=1', { method: 'POST' })).status).toBe(405)
    const refused = await request('/api/catalog/delivery/estimate?area_id=9')
    expect(refused.status).toBe(422)
    expect((await refused.json()).message).toBe('Delivery areas are for Bangladesh addresses.')
  })
})

describe('best selling list (public catalog)', () => {
  it('passes units_sold and meta.has_sales on, so the home page only calls real sellers "Best selling"', async () => {
    const calls = fakeLaravel({
      'GET /api/v1/products': { body: { data: [{ id: 1, name: 'Mascara', units_sold: 12 }], meta: { current_page: 1, per_page: 4, total: 1, last_page: 1, path: 'http://laravel.test/api/v1/products', has_sales: true } } },
    })
    const response = await request('/api/catalog/products?sort=best_selling&per_page=4')
    const body = await response.json()
    expect(calls[0].search).toContain('sort=best_selling')
    expect(body.meta).toEqual({ current_page: 1, per_page: 4, total: 1, last_page: 1, has_sales: true })
    expect(body.data[0].units_sold).toBe(12)
  })
})
