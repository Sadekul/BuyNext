// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { handleSeoRequest, robotsTxt } from './seoApi'

/*
 * Phase 7 storefront services: catalog price rules and cart rules in carts
 * and orders, the newsletter, the saved cart (/api/shop), redirects and
 * search-term redirects (/api/catalog), the profile's newsletter switch
 * (/api/auth), and /sitemap.xml + /robots.txt.
 */

const SITE = 'https://shop.example'

/** Fakes the Laravel API: `routes` maps "METHOD /path" to { status, body } or { raw, headers }. Records each call. */
function fakeUpstream(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    calls.push({ url: String(url), path: pathname, search, init, body: init.body ? JSON.parse(init.body) : undefined })
    const route = routes[`${init.method ?? 'GET'} ${pathname}`] ?? { status: 404, body: { message: 'Not found' } }
    if (route.raw !== undefined) return new Response(route.raw, { status: route.status ?? 200, headers: route.headers })
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

const call = (area, path, { method = 'GET', body, cookie } = {}) =>
  handleApiRequest(
    new Request(`${SITE}/api/${area}/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }) },
      body: body && JSON.stringify(body),
    }),
  )
const shop = (path, options) => call('shop', path, options)

beforeEach(() => vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test'))
afterEach(() => vi.unstubAllEnvs())

const TOTALS = { item_count: 1, subtotal: '18.00', discount: '5.00', shipping: '0.00', tax: '0.00', total: '13.00' }
const LINE = {
  product_id: 5,
  name: 'Tee',
  price: '20.00',
  discount_percent: 0,
  sale_price: '18.00',
  quantity: 1,
  line_total: '18.00',
  price_rule: { id: 3, name: 'VIP week' },
  price_label: 'VIP price',
  discount: '5.00',
}

describe('price rules in carts and orders (server/shop/laravel.js)', () => {
  it('passes on the price label, each line discount, and the applied cart rules', async () => {
    fakeUpstream({
      'POST /api/v1/cart/validate': {
        body: {
          data: {
            lines: [{ ...LINE, available: true, stock_quantity: 4 }],
            coupon: { code: 'NEST5', description: '$5 off' },
            applied_rules: [
              { id: 9, code: null, label: 'Free shipping over $10', automatic: true, discount: '0.00', free_shipping: true },
              { id: 4, code: 'NEST5', label: '$5 off', automatic: false, discount: '5.00', free_shipping: false, internal: 'x' },
            ],
            totals: TOTALS,
          },
        },
      },
    })
    const cart = await (await shop('cart/validate', { method: 'POST', body: { items: [{ productId: 5, quantity: 1 }], couponCode: 'NEST5' } })).json()
    expect(cart.lines[0]).toMatchObject({ priceLabel: 'VIP price', discount: 5, salePrice: 18 })
    expect(cart.appliedRules).toEqual([
      { id: 9, code: null, label: 'Free shipping over $10', automatic: true, discount: 0, freeShipping: true },
      { id: 4, code: 'NEST5', label: '$5 off', automatic: false, discount: 5, freeShipping: false },
    ])
  })

  it('gives older lines and orders no label and an empty rule list', async () => {
    fakeUpstream({ 'GET /api/v1/orders/BN-100001': { body: { data: { number: 'BN-100001', items: [{ ...LINE, price_label: null, discount: null }], totals: TOTALS } } } })
    const order = await (await shop('orders/BN-100001', { cookie: 'buynest_at=AT' })).json()
    expect(order.items[0]).not.toHaveProperty('priceLabel')
    expect(order.items[0]).not.toHaveProperty('discount')
    expect(order.appliedRules).toEqual([])
  })
})

describe('newsletter (POST /api/shop/newsletter…)', () => {
  const MESSAGE = "Thanks! If this address isn't subscribed yet, we've sent you a link to confirm."

  it('subscribes with only the email and a known source, and answers 202', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/newsletter': { status: 202, body: { message: MESSAGE } } })
    const response = await shop('newsletter', { method: 'POST', body: { email: ' ava@example.com ', source: 'admin', customer_id: 1 } })
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ message: MESSAGE })
    expect(calls[0].body).toEqual({ email: 'ava@example.com', source: 'footer' })
  })

  it('passes on 422 for an invalid email and 429 when rate-limited', async () => {
    fakeUpstream({ 'POST /api/v1/newsletter': { status: 422, body: { message: 'Invalid.', errors: { email: ['Enter a valid email.'], other: ['x'] } } } })
    const invalid = await shop('newsletter', { method: 'POST', body: { email: 'nope' } })
    expect(invalid.status).toBe(422)
    expect(await invalid.json()).toEqual({ message: 'Invalid.', errors: { email: ['Enter a valid email.'] } })

    fakeUpstream({ 'POST /api/v1/newsletter': { status: 429, body: { message: 'Too many attempts.' } } })
    expect((await shop('newsletter', { method: 'POST', body: { email: 'a@b.co' } })).status).toBe(429)
  })

  it('confirms and unsubscribes with a token, mapping only email and status', async () => {
    const calls = fakeUpstream({
      'POST /api/v1/newsletter/confirm': { body: { message: "You're subscribed.", data: { email: 'ava@example.com', status: 'subscribed', id: 4 } } },
      'POST /api/v1/newsletter/unsubscribe': { body: { message: "You're unsubscribed.", data: { email: 'ava@example.com', status: 'unsubscribed' } } },
    })
    expect(await (await shop('newsletter/confirm', { method: 'POST', body: { token: 'abc123' } })).json()).toEqual({ message: "You're subscribed.", email: 'ava@example.com', status: 'subscribed' })
    expect(await (await shop('newsletter/unsubscribe', { method: 'POST', body: { token: '12.f00d' } })).json()).toMatchObject({ status: 'unsubscribed' })
    expect(calls.map((entry) => entry.body)).toEqual([{ token: 'abc123' }, { token: '12.f00d' }])
  })

  it('refuses a malformed token without asking the API', async () => {
    const calls = fakeUpstream({})
    const response = await shop('newsletter/unsubscribe', { method: 'POST', body: { token: '<script>' } })
    expect(response.status).toBe(422)
    expect((await response.json()).errors.token[0]).toMatch(/invalid/)
    expect(calls).toHaveLength(0)
  })
})

describe('saved cart (GET /api/shop/me/cart, POST /api/shop/me/cart/merge)', () => {
  const SAVED = { data: { items: [{ product_id: 5, variant_id: null, quantity: 2 }, { product_id: 6, variant_id: 61, quantity: 1 }], item_count: 3, updated_at: '2026-11-17T10:00:00Z' } }
  const PRICED = {
    data: {
      lines: [
        { ...LINE, quantity: 2, available: true, stock_quantity: 4, min_order_quantity: 1, thumbnail_url: 'https://cdn.example/tee.webp', sku: 'TEE' },
        { ...LINE, product_id: 6, variant_id: 61, variant_label: 'Size: M', name: 'Cap', quantity: 1, available: true, stock_quantity: 1, price_rule: null, sale_price: '20.00' },
      ],
      totals: TOTALS,
    },
  }

  it('needs a session', async () => {
    fakeUpstream({})
    expect((await shop('me/cart')).status).toBe(401)
    expect((await shop('me/cart/merge', { method: 'POST', body: { items: [] } })).status).toBe(401)
  })

  it("returns the saved lines with names, prices, and stock, priced as a guest (so nothing is saved again)", async () => {
    const calls = fakeUpstream({ 'GET /api/v1/me/cart': { body: SAVED }, 'POST /api/v1/cart/validate': { body: PRICED } })
    const answer = await (await shop('me/cart', { cookie: 'buynest_at=AT' })).json()
    expect(calls[0].init.headers.Authorization).toBe('Bearer AT')
    expect(calls[1].init.headers.Authorization).toBeUndefined()
    expect(calls[1].body.items).toEqual([{ product_id: 5, quantity: 2 }, { product_id: 6, variant_id: 61, quantity: 1 }])
    expect(answer).toMatchObject({ itemCount: 3, updatedAt: '2026-11-17T10:00:00Z' })
    expect(answer.items).toEqual([
      { productId: 5, title: 'Tee', thumbnail: 'https://cdn.example/tee.webp', sku: 'TEE', price: 20, salePrice: 18, discountPercentage: 0, stock: 4, minimumOrderQuantity: 1, quantity: 2 },
      { productId: 6, variantId: 61, variantLabel: 'Size: M', title: 'Cap', thumbnail: null, sku: null, price: 20, salePrice: 20, discountPercentage: 0, stock: 1, minimumOrderQuantity: 1, quantity: 1 },
    ])
  })

  it('answers an empty saved cart without pricing anything', async () => {
    const calls = fakeUpstream({ 'GET /api/v1/me/cart': { body: { data: { items: [], item_count: 0, updated_at: null } } } })
    expect(await (await shop('me/cart', { cookie: 'buynest_at=AT' })).json()).toEqual({ items: [], itemCount: 0, updatedAt: null })
    expect(calls).toHaveLength(1)
  })

  it('merges only valid lines (at most 50) and returns the merged cart', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/me/cart/merge': { body: SAVED }, 'POST /api/v1/cart/validate': { body: PRICED } })
    const items = [{ productId: 5, quantity: 2, price: 0.01 }, { productId: 6, variantId: 61, quantity: 1 }, { productId: 'x', quantity: 1 }, { productId: 7, quantity: 0 }]
    const response = await shop('me/cart/merge', { method: 'POST', cookie: 'buynest_at=AT', body: { items } })
    expect(response.status).toBe(200)
    expect(calls[0].body).toEqual({ items: [{ product_id: 5, quantity: 2 }, { product_id: 6, variant_id: 61, quantity: 1 }] })
    expect((await response.json()).items).toHaveLength(2)
  })
})

describe('catalog: redirects and search redirects (/api/catalog)', () => {
  it('looks up a redirect by path, and passes a 404 on', async () => {
    const calls = fakeUpstream({ 'GET /api/v1/redirects': { body: { data: { from_path: '/old', to_path: '/products/5', status_code: 301 } } } })
    const response = await call('catalog', 'redirects?path=%2FOld%3Fx%3D1')
    expect(await response.json()).toEqual({ data: { from_path: '/old', to_path: '/products/5', status_code: 301 } })
    expect(new URLSearchParams(calls[0].search).get('path')).toBe('/Old?x=1')

    fakeUpstream({ 'GET /api/v1/redirects': { status: 404, body: { message: 'No redirect for this path.' } } })
    expect((await call('catalog', 'redirects?path=/nothing')).status).toBe(404)
  })

  it("refuses lookups that aren't store paths", async () => {
    const calls = fakeUpstream({})
    expect((await call('catalog', 'redirects?path=https://evil.example')).status).toBe(404)
    expect((await call('catalog', 'redirects')).status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it("passes a search term's redirect_url on in the list's meta", async () => {
    fakeUpstream({ 'GET /api/v1/products': { body: { data: [], meta: { current_page: 1, per_page: 6, total: 0, last_page: 1, path: 'http://laravel.test/x', redirect_url: '/deals' } } } })
    const answer = await (await call('catalog', 'products?search=sale')).json()
    expect(answer.meta).toEqual({ current_page: 1, per_page: 6, total: 0, last_page: 1, redirect_url: '/deals' })
  })
})

describe('newsletter switch on the profile (PUT /api/auth/profile)', () => {
  const CUSTOMER = { id: 3, first_name: 'Ava', last_name: 'Cole', email: 'ava@example.com', phone: null, email_verified: true, newsletter: true }

  it('sends only the newsletter flag when that is all that changed, and maps it back', async () => {
    vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
    const calls = fakeUpstream({ 'PATCH /api/v1/me': { body: { data: CUSTOMER } } })
    const response = await call('auth', 'profile', { method: 'PUT', cookie: 'buynest_at=AT', body: { newsletter: true, admin: true } })
    expect(calls[0].body).toEqual({ newsletter: true })
    expect(await response.json()).toMatchObject({ id: 3, newsletter: true })
  })

  it('leaves `newsletter` out of profiles from an API that has none', async () => {
    vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
    fakeUpstream({ 'GET /api/v1/me': { body: { data: { ...CUSTOMER, newsletter: undefined } } } })
    expect(await (await call('auth', 'me', { cookie: 'buynest_at=AT' })).json()).not.toHaveProperty('newsletter')
  })
})

describe('sitemap.xml and robots.txt (server/seoApi.js)', () => {
  const seo = (path, method = 'GET') => handleSeoRequest(new Request(`${SITE}${path}`, { method }))
  const XML = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://shop.example/</loc></url></urlset>'

  it('writes robots.txt pointing at this site\'s sitemap and keeping crawlers out of private areas', async () => {
    const response = await seo('/robots.txt')
    expect(response.headers.get('content-type')).toMatch(/^text\/plain/)
    const text = await response.text()
    expect(text).toBe(robotsTxt(SITE))
    for (const line of ['Disallow: /admin/', 'Disallow: /account', 'Disallow: /checkout', 'Disallow: /api/', 'Sitemap: https://shop.example/sitemap.xml']) expect(text).toContain(line)
  })

  it("passes the API's sitemap on (also at the Vercel function's address)", async () => {
    vi.stubEnv('VITE_API_PROVIDER', 'laravel')
    const calls = fakeUpstream({ 'GET /api/v1/sitemap.xml': { raw: XML, headers: { 'Content-Type': 'application/xml' } } })
    for (const path of ['/sitemap.xml', '/api/seo/sitemap.xml']) {
      const response = await seo(path)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8')
      expect(response.headers.get('cache-control')).toBe('public, max-age=900')
      expect(await response.text()).toBe(XML)
    }
    expect(calls[0].url).toBe('http://laravel.test/api/v1/sitemap.xml')
  })

  it("doesn't pass on an answer that isn't a sitemap", async () => {
    vi.stubEnv('VITE_API_PROVIDER', 'laravel')
    fakeUpstream({ 'GET /api/v1/sitemap.xml': { raw: '<html>oops</html>', headers: { 'Content-Type': 'text/html' } } })
    const response = await seo('/sitemap.xml')
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('oops')
  })

  it('lists the main pages in the DummyJSON demo, without calling any API', async () => {
    const calls = fakeUpstream({})
    const text = await (await seo('/sitemap.xml')).text()
    expect(text).toContain('<loc>https://shop.example/products</loc>')
    expect(calls).toHaveLength(0)
  })

  it('answers HEAD without a body, other methods with 405, other files with 404', async () => {
    const head = await seo('/robots.txt', 'HEAD')
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    const post = await seo('/robots.txt', 'POST')
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
    expect((await seo('/api/seo/other.txt')).status).toBe(404)
  })
})
