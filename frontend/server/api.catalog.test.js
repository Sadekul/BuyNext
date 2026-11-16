// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { handleMediaRequest, mediaPath } from './mediaApi'

/*
 * Phase 5 storefront services: variants in carts and orders, product
 * reviews (/api/shop), and uploaded product photos (/media).
 */

const SITE = 'https://shop.example'
const HEX = '0123456789abcdef0123456789abcdef'

/** Fakes the Laravel API: `routes` maps "METHOD /path" to { status, body }. Records each call. */
function fakeUpstream(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname } = new URL(url)
    calls.push({ url: String(url), path: pathname, init })
    const route = routes[`${init.method ?? 'GET'} ${pathname}`] ?? { status: 404, body: { message: 'Not found' } }
    if (route.raw) return new Response(route.raw, { status: route.status ?? 200, headers: route.headers })
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

const shop = (path, { method = 'GET', body, cookie } = {}) =>
  handleApiRequest(
    new Request(`${SITE}/api/shop/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }) },
      body: body && JSON.stringify(body),
    }),
  )

beforeEach(() => vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test'))
afterEach(() => vi.unstubAllEnvs())

describe('variants in carts and orders (server/shop/laravel.js)', () => {
  const LINE = { product_id: 5, variant_id: 51, variant_label: 'Size: M / Color: Red', sku: 'TEE-M-RED', name: 'Tee', price: '20.00', discount_percent: 0, sale_price: '20.00', quantity: 1, line_total: '20.00' }
  const TOTALS = { item_count: 1, subtotal: '20.00', discount: '0.00', shipping: '4.99', tax: '0.00', total: '24.99' }

  it('sends variant_id only for lines that have one, and maps the variant label back', async () => {
    const calls = fakeUpstream({
      'POST /api/v1/cart/validate': {
        body: { data: { lines: [{ ...LINE, available: true }, { ...LINE, product_id: 6, variant_id: null, variant_label: null, available: true }], problems: [{ product_id: 5, variant_id: 51, code: 'insufficient_stock', message: 'Only 1 left.' }], totals: TOTALS } },
      },
    })
    const response = await shop('cart/validate', { method: 'POST', body: { items: [{ productId: 5, variantId: 51, quantity: 1 }, { productId: 6, quantity: 2 }, { productId: 7, variantId: 'x', quantity: 1 }] } })
    expect(JSON.parse(calls[0].init.body).items).toEqual([
      { product_id: 5, variant_id: 51, quantity: 1 },
      { product_id: 6, quantity: 2 },
      { product_id: 7, quantity: 1 }, // not a valid id: left out (the API then answers 422 for that line)
    ])
    const cart = await response.json()
    expect(cart.lines[0]).toMatchObject({ productId: 5, variantId: 51, variantLabel: 'Size: M / Color: Red', sku: 'TEE-M-RED' })
    expect(cart.lines[1]).not.toHaveProperty('variantId')
    expect(cart.problems[0]).toEqual({ productId: 5, variantId: 51, code: 'insufficient_stock', message: 'Only 1 left.' })
  })

  it('shows the variant label on orders', async () => {
    fakeUpstream({ 'GET /api/v1/orders/BN-100001': { body: { data: { number: 'BN-100001', items: [LINE], totals: TOTALS } } } })
    const response = await shop('orders/BN-100001', { cookie: 'buynest_at=AT' })
    expect((await response.json()).items[0]).toMatchObject({ variantId: 51, variantLabel: 'Size: M / Color: Red' })
  })
})

describe('product reviews (POST /api/shop/products/:id/reviews)', () => {
  const REVIEW = { id: 9, rating: 5, title: 'Lovely', comment: 'Soft and fits well.', status: 'pending', verified_purchase: true, author_name: 'Ava C.', created_at: '2026-11-16T10:00:00Z', customer_id: 3, email: 'ava@example.com' }

  it('needs the customer session', async () => {
    const calls = fakeUpstream({})
    const response = await shop('products/5/reviews', { method: 'POST', body: { rating: 5, comment: 'Soft and fits well.' } })
    expect(response.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it("forwards only the review fields with the customer's token, and returns a safe review", async () => {
    const calls = fakeUpstream({ 'POST /api/v1/products/5/reviews': { status: 201, body: { data: REVIEW } } })
    const response = await shop('products/5/reviews', {
      method: 'POST',
      cookie: 'buynest_at=AT',
      body: { rating: 5, title: ' Lovely ', comment: ' Soft and fits well. ', status: 'approved', verified_purchase: true },
    })
    expect(response.status).toBe(201)
    expect(calls[0].init.headers.Authorization).toBe('Bearer AT')
    expect(JSON.parse(calls[0].init.body)).toEqual({ rating: 5, title: 'Lovely', comment: 'Soft and fits well.' })
    const review = await response.json()
    expect(review).toEqual({ id: 9, rating: 5, title: 'Lovely', comment: 'Soft and fits well.', status: 'pending', verifiedPurchase: true, reviewerName: 'Ava C.', date: '2026-11-16T10:00:00Z' })
  })

  it('passes "already reviewed" on as a code the page can explain', async () => {
    fakeUpstream({ 'POST /api/v1/products/5/reviews': { status: 422, body: { message: 'You have already reviewed this product.', code: 'already_reviewed' } } })
    const response = await shop('products/5/reviews', { method: 'POST', cookie: 'buynest_at=AT', body: { rating: 4, comment: 'Second try here.' } })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'already_reviewed' })
  })

  it('only matches numeric product ids and POST', async () => {
    fakeUpstream({})
    expect((await shop('products/abc/reviews', { method: 'POST', cookie: 'buynest_at=AT', body: {} })).status).toBe(404)
    expect((await shop('products/5/reviews', { cookie: 'buynest_at=AT' })).status).toBe(404)
    expect((await shop('products/5/reviews/1', { method: 'POST', cookie: 'buynest_at=AT', body: {} })).status).toBe(404)
  })
})

describe('uploaded product photos (server/mediaApi.js)', () => {
  const media = (path, method = 'GET') => handleMediaRequest(new Request(`${SITE}${path}`, { method }))

  it('streams an allowed file from the API storage, typed by its extension and cached for a year', async () => {
    const calls = fakeUpstream({ [`GET /storage/products/12/${HEX}.webp`]: { raw: 'RIFF-image-bytes', headers: { 'Content-Type': 'text/html', 'Content-Length': '16' } } })
    const response = await media(`/media/products/12/${HEX}.webp`)
    expect(response.status).toBe(200)
    expect(calls[0].url).toBe(`http://laravel.test/storage/products/12/${HEX}.webp`)
    expect(response.headers.get('content-type')).toBe('image/webp') // never the upstream's type
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('RIFF-image-bytes')
  })

  it.each([
    '/media/products/12/photo.jpg', // not a generated name
    `/media/products/12/${HEX}.svg`, // not an allowed type
    `/media/products/12/${HEX}.php`,
    `/media/products/12/${HEX.toUpperCase()}.jpg`,
    `/media/products/x/${HEX}.jpg`,
    `/media/products/12/../../.env`,
    `/media/products/12/%2e%2e/${HEX}.jpg`,
    `/media/avatars/12/${HEX}.jpg`,
    `/media/products/12/${HEX}.jpg/extra`,
    '/media/',
  ])('answers 404 for %s without asking the API', async (path) => {
    const calls = fakeUpstream({})
    const response = await media(path)
    expect(response.status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('answers 404 when the API has no such file, and for other methods', async () => {
    fakeUpstream({})
    expect((await media(`/media/products/12/${HEX}.png`)).status).toBe(404)
    expect((await media(`/media/products/12/${HEX}.png`, 'POST')).status).toBe(404)
  })

  it('also accepts the path a host rewrite produces (/api/media/…)', () => {
    expect(mediaPath(`/api/media/products/3/${HEX}.jpg`)).toBe(`products/3/${HEX}.jpg`)
    expect(mediaPath(`/media/products/3/${HEX}.jpg`)).toBe(`products/3/${HEX}.jpg`)
    expect(mediaPath(`/other/products/3/${HEX}.jpg`)).toBeNull()
  })
})
