// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { fromMyReview, fromMyReviewList, fromMyReviewPhotos } from './shop/laravel'

/*
 * Phase 23 (docs/backend/PHASE23_CONTRACT.md §2): My reviews. The customer's
 * own reviews in every status, through an allow-list; their photos from a
 * private, never-cached address; deleting a review or one of its photos.
 * Someone else's review is the API's 404, passed on unchanged.
 */

const SITE = 'https://shop.example'
const SIGNED_IN = 'buynest_at=AT'

function fakeUpstream(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const parsed = new URL(url)
    calls.push({ url: String(url), path: parsed.pathname, search: parsed.search, init })
    const route = routes[`${init.method ?? 'GET'} ${parsed.pathname}`] ?? { status: 404, body: { message: 'Not found.' } }
    if (route.status === 204) return new Response(null, { status: 204 })
    if (route.raw !== undefined) return new Response(route.raw, { status: route.status ?? 200, headers: route.headers })
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

const call = (path, { method = 'GET', cookie = SIGNED_IN, headers = {} } = {}) =>
  handleApiRequest(new Request(`${SITE}/api/${path}`, { method, headers: { 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }), ...headers } }))

const PHOTO_URL = (review, photo) => `/api/shop/me/reviews/${review}/photos/${photo}`

/** The API's review item (ReviewResource for the author). */
const API_REVIEW = {
  id: 41,
  status: 'approved',
  rating: 4,
  title: 'True colour',
  comment: 'The colour is exactly as shown.',
  created_at: '2026-11-28T10:00:00Z',
  verified_purchase: true,
  customer_id: 5,
  email: 'ava@example.com',
  product: { id: 12, name: 'Desk Lamp', thumbnail_url: '/media/products/12/abc.webp', available: true, sku: 'LAMP-1', price: '30.00' },
  photos: [
    { id: 8, url: PHOTO_URL(41, 8), width: 800, height: 600, hidden: true, position: 1, path: 'review-photos/41/x.jpg' },
    { id: 7, url: PHOTO_URL(41, 7), width: 1200, height: 1600, hidden: false, position: 0 },
  ],
}
const REVIEW = {
  id: 41,
  status: 'approved',
  rating: 4,
  title: 'True colour',
  comment: 'The colour is exactly as shown.',
  date: '2026-11-28T10:00:00Z',
  verifiedPurchase: true,
  product: { id: 12, name: 'Desk Lamp', thumbnail: '/media/products/12/abc.webp', available: true },
  photos: [
    { id: 7, url: PHOTO_URL(41, 7), width: 1200, height: 1600, hidden: false },
    { id: 8, url: PHOTO_URL(41, 8), width: 800, height: 600, hidden: true },
  ],
}

beforeEach(() => {
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
  vi.stubEnv('BUYNEST_BFF_KEY', 'shared-key')
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/shop/me/reviews', () => {
  it("lists the customer's reviews through the allow-list, with the token and the page", async () => {
    const calls = fakeUpstream({
      'GET /api/v1/me/reviews': { body: { data: [API_REVIEW], meta: { current_page: 2, last_page: 3, per_page: 10, total: 21 }, links: { next: 'http://laravel.test/x' } } },
    })
    const response = await call('shop/me/reviews?page=2')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ reviews: [REVIEW], page: 2, pages: 3, total: 21 })
    expect(calls[0].search).toBe('?page=2')
    expect(calls[0].init.headers.Authorization).toBe('Bearer AT')
    expect(calls[0].init.headers['X-BuyNest-Bff']).toBe('shared-key')
  })

  it('passes productId on as product_id (only a whole number)', async () => {
    const calls = fakeUpstream({ 'GET /api/v1/me/reviews': { body: { data: [], meta: { current_page: 1, last_page: 1, total: 0 } } } })
    expect(await (await call('shop/me/reviews?productId=12')).json()).toEqual({ reviews: [], page: 1, pages: 1, total: 0 })
    await call('shop/me/reviews?productId=12%26customer_id%3D9')
    expect(calls.map((entry) => entry.search)).toEqual(['?page=1&product_id=12', '?page=1'])
  })

  it('without a session → 401, and the API is never called', async () => {
    const calls = fakeUpstream({})
    expect((await call('shop/me/reviews', { cookie: null })).status).toBe(401)
    expect((await call(`shop${PHOTO_URL(41, 7).slice('/api/shop'.length)}`, { cookie: null })).status).toBe(401)
    expect((await call('shop/me/reviews/41', { method: 'DELETE', cookie: null })).status).toBe(401)
    expect((await call('shop/me/reviews/41/photos/7', { method: 'DELETE', cookie: null })).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('passes the API errors on (a staff token refused, the API down)', async () => {
    fakeUpstream({ 'GET /api/v1/me/reviews': { status: 403, body: { message: 'Customers only.', code: 'customer_only', trace: 'x' } } })
    const response = await call('shop/me/reviews')
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ message: 'Customers only.', code: 'customer_only' })
  })
})

describe('the allow-list', () => {
  it('keeps only the listed fields; status falls back to pending', () => {
    const review = fromMyReview({ ...API_REVIEW, status: 'deleted', rating: 9, title: '' })
    expect(Object.keys(review).sort()).toEqual(['comment', 'date', 'id', 'photos', 'product', 'rating', 'status', 'title', 'verifiedPurchase'])
    expect(review.status).toBe('pending')
    expect(review.rating).toBeNull()
    expect(review.title).toBeNull()
    expect(Object.keys(review.product).sort()).toEqual(['available', 'id', 'name', 'thumbnail'])
  })

  it('a deleted product is null; an unavailable one says so; only safe thumbnails', () => {
    expect(fromMyReview({ ...API_REVIEW, product: null }).product).toBeNull()
    expect(fromMyReview({ ...API_REVIEW, product: { name: 'No id' } }).product).toBeNull()
    expect(fromMyReview({ ...API_REVIEW, product: { id: 12, name: 'Lamp', available: 'yes', thumbnail_url: 'javascript:alert(1)' } }).product).toEqual({ id: 12, name: 'Lamp', thumbnail: null, available: false })
    expect(fromMyReview({ ...API_REVIEW, product: { id: 12, name: 'Lamp', available: true, thumbnail_url: 'http://insecure.test/a.jpg' } }).product.thumbnail).toBeNull()
  })

  it('a photo is kept only with the owner URL shape, in position order, hidden as a boolean', () => {
    const photos = fromMyReviewPhotos([
      { id: 1, url: '/media/reviews/0123456789abcdef0123456789abcdef.jpg', width: 10, height: 10 }, // a public URL: not this list's
      { id: 2, url: 'https://evil.test/api/shop/me/reviews/41/photos/2' },
      { id: 3, url: '/api/shop/me/reviews/41/photos/3?x=1' },
      { id: 4, url: '/api/shop/me/reviews/41/photos/../../admin' },
      { id: 'x', url: PHOTO_URL(41, 5) },
      { id: 6, url: PHOTO_URL(41, 6), width: 'big', height: -1, hidden: 'yes', position: 2 },
      { id: 7, url: PHOTO_URL(41, 7), width: 640, height: 480, hidden: true, position: 0 },
      null,
    ])
    expect(photos).toEqual([
      { id: 7, url: PHOTO_URL(41, 7), width: 640, height: 480, hidden: true },
      { id: 6, url: PHOTO_URL(41, 6), width: null, height: null, hidden: false },
    ])
  })

  it('a list item without an id is dropped; pages and total fall back sensibly', () => {
    expect(fromMyReviewList({ data: [{ ...API_REVIEW, id: null }, API_REVIEW] })).toEqual({ reviews: [REVIEW], page: 1, pages: 1, total: 1 })
    expect(fromMyReviewList({})).toEqual({ reviews: [], page: 1, pages: 1, total: 0 })
  })
})

describe('GET /api/shop/me/reviews/:id/photos/:photoId (the author’s photo)', () => {
  it('passes the photo on, private, never cached, sandboxed', async () => {
    const calls = fakeUpstream({ 'GET /api/v1/me/reviews/41/photos/8': { raw: '\xff\xd8\xffJPEG', headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=9999' } } })
    const response = await call('shop/me/reviews/41/photos/8')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(Number(response.headers.get('content-length'))).toBeGreaterThan(0)
    expect(calls[0].init.headers.Authorization).toBe('Bearer AT')
    expect(calls[0].init.headers['X-BuyNest-Bff']).toBe('shared-key')
  })

  it("someone else's photo is the API's 404", async () => {
    fakeUpstream({ 'GET /api/v1/me/reviews/41/photos/8': { status: 404, body: { message: 'Not found.' } } })
    const response = await call('shop/me/reviews/41/photos/8')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ message: 'Not found.' })
  })

  it('only JPEG, PNG or WebP, at most 10 MB', async () => {
    fakeUpstream({
      'GET /api/v1/me/reviews/41/photos/8': { raw: '<svg onload="alert(1)"/>', headers: { 'Content-Type': 'image/svg+xml' } },
      'GET /api/v1/me/reviews/41/photos/9': { raw: 'x', headers: { 'Content-Type': 'image/png', 'Content-Length': String(11 * 1024 * 1024) } },
      'GET /api/v1/me/reviews/41/photos/10': { raw: 'webp', headers: { 'Content-Type': 'image/webp' } },
    })
    expect((await call('shop/me/reviews/41/photos/8')).status).toBe(502)
    expect((await call('shop/me/reviews/41/photos/9')).status).toBe(502)
    const webp = await call('shop/me/reviews/41/photos/10')
    expect(webp.status).toBe(200)
    expect(webp.headers.get('content-type')).toBe('image/webp')
  })

  it('malformed ids never reach the API', async () => {
    const calls = fakeUpstream({})
    for (const path of ['me/reviews/abc/photos/1', 'me/reviews/1/photos/x', 'me/reviews/1/photos', 'me/reviews/1/photos/1/2', 'me/reviews/-1']) {
      expect((await call(`shop/${path}`)).status).toBe(404)
    }
    expect((await call('shop/me/reviews/1/photos/2', { method: 'POST' })).status).toBe(404)
    expect((await call('shop/me/reviews/41', { method: 'GET' })).status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('a cross-site request is refused', async () => {
    const calls = fakeUpstream({})
    expect((await call('shop/me/reviews/41/photos/8', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403)
    expect(calls).toHaveLength(0)
  })
})

describe('deleting', () => {
  it('DELETE a review → { deleted: true } (the API answers 204)', async () => {
    const calls = fakeUpstream({ 'DELETE /api/v1/me/reviews/41': { status: 204 } })
    const response = await call('shop/me/reviews/41', { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: true })
    expect(calls[0].init.method).toBe('DELETE')
    expect(calls[0].init.headers.Authorization).toBe('Bearer AT')
  })

  it("someone else's review → the API's 404; the throttle's 429 goes through", async () => {
    fakeUpstream({
      'DELETE /api/v1/me/reviews/42': { status: 404, body: { message: 'Not found.' } },
      'DELETE /api/v1/me/reviews/43': { status: 429, body: { message: 'Too many requests.' } },
    })
    expect((await call('shop/me/reviews/42', { method: 'DELETE' })).status).toBe(404)
    expect((await call('shop/me/reviews/43', { method: 'DELETE' })).status).toBe(429)
  })

  it('DELETE a photo → { review } with the photos left', async () => {
    const left = { ...API_REVIEW, photos: [{ ...API_REVIEW.photos[1], position: 0 }] }
    const calls = fakeUpstream({ 'DELETE /api/v1/me/reviews/41/photos/8': { body: { data: left } } })
    const response = await call('shop/me/reviews/41/photos/8', { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ review: { ...REVIEW, photos: [REVIEW.photos[0]] } })
    expect(calls[0].path).toBe('/api/v1/me/reviews/41/photos/8')
  })

  it("someone else's photo → 404", async () => {
    fakeUpstream({ 'DELETE /api/v1/me/reviews/41/photos/9': { status: 404, body: { message: 'Not found.' } } })
    expect((await call('shop/me/reviews/41/photos/9', { method: 'DELETE' })).status).toBe(404)
  })
})
