// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { reviewPhotos } from './shop/adminCatalog.js'

/*
 * Phase 22 admin routes (docs/backend/PHASE22_CONTRACT.md §3): a review's
 * photos in the review list, the "with photos" filter, hiding or showing one
 * photo, the staff photo stream, and the catalog setting
 * `review_photos_enabled`. Laravel is faked with the snake_case shapes of §1.
 * Each new field has a test: a field missing from an allow-list was lost
 * before (phase 17).
 */

const SITE = 'https://shop.example'
const ME = { id: 1, name: 'Store Owner', email: 'admin@buynest.test', role: { id: 1, name: 'Owner' }, permissions: ['reviews.view', 'reviews.moderate', 'settings.view', 'settings.edit'] }

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const entry = { method: init.method ?? 'GET', path: pathname, search, headers: init.headers ?? {}, body: init.body }
    calls.push(entry)
    const key = `${entry.method} ${pathname}`
    const found = key === 'GET /api/admin/v1/me' ? { body: { data: ME } } : routes[key]
    const route = typeof found === 'function' ? found(entry) : (found ?? { status: 404, body: { message: 'Not found' } })
    if (route.bytes !== undefined) return new Response(route.bytes, { status: route.status ?? 200, headers: route.headers })
    return new Response(route.status === 204 ? null : JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

function admin(action, { method = 'GET', body, cookie = 'buynest_admin_at=9|ADMIN' } = {}) {
  return handleApiRequest(
    new Request(`${SITE}/api/admin/${action}`, {
      method,
      headers: { 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  )
}
const sent = (entry) => JSON.parse(entry.body)
const toApi = (calls) => calls.filter((entry) => entry.path !== '/api/admin/v1/me')
const query = (entry) => Object.fromEntries(new URLSearchParams(entry.search))

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const PHOTO = { id: 9, hidden: false, width: 1200, height: 900, size_bytes: 183_204, position: 0, name: 'a'.repeat(32) + '.jpg', path: 'review-photos/41/secret.jpg' }
const REVIEW = {
  id: 41,
  product: { id: 4, name: 'Saree', sku: 'SAR-1' },
  author_name: 'Nadia R.',
  rating: 4,
  title: 'True colour',
  comment: 'Same as the photos.',
  status: 'pending',
  verified_purchase: true,
  created_at: 'T',
  photos: [PHOTO, { id: 10, hidden: true, width: 800, height: 600, size_bytes: 90_000, position: 1 }],
}
const PHOTOS_OUT = [
  { id: 9, hidden: false, width: 1200, height: 900, sizeBytes: 183_204, position: 0, url: '/api/admin/reviews/41/photos/9' },
  { id: 10, hidden: true, width: 800, height: 600, sizeBytes: 90_000, position: 1, url: '/api/admin/reviews/41/photos/10' },
]
// A few bytes that start like a JPEG; the service never looks inside them.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])

describe('review photos in the list', () => {
  it('maps each photo (allow-listed, with its admin URL) and sends the has_photos filter', async () => {
    const calls = fakeLaravel({ 'GET /api/admin/v1/reviews': { body: { data: [REVIEW, { ...REVIEW, id: 42, photos: undefined }], meta: { total: 2 } } } })
    const list = await (await admin('reviews?hasPhotos=true&status=pending')).json()
    expect(list.reviews[0].photos).toEqual(PHOTOS_OUT)
    expect(list.reviews[0].photos[0]).not.toHaveProperty('name')
    expect(list.reviews[0].photos[0]).not.toHaveProperty('path')
    expect(list.reviews[1].photos).toEqual([])
    expect(query(toApi(calls)[0])).toEqual({ page: '1', per_page: '20', status: 'pending', has_photos: '1' })

    await admin('reviews?hasPhotos=1')
    expect(query(toApi(calls).at(-1))).toEqual({ page: '1', per_page: '20', has_photos: '1' })
    for (const value of ['0', 'false', 'yes', '']) {
      await admin(`reviews?hasPhotos=${value}`)
      expect(query(toApi(calls).at(-1))).toEqual({ page: '1', per_page: '20' })
    }
  })

  it('drops photos without an integer id, and every photo of a review without one', () => {
    expect(reviewPhotos([{ id: '9' }, { id: 1.5 }, null, { id: -1 }, { id: 3, hidden: 'yes', width: 'big', position: 2 }], 7)).toEqual([
      { id: 3, hidden: false, width: null, height: null, sizeBytes: null, position: 2, url: '/api/admin/reviews/7/photos/3' },
    ])
    expect(reviewPhotos([{ id: 3 }], '7')).toEqual([])
    expect(reviewPhotos('nope', 7)).toEqual([])
  })
})

describe('hiding and showing a photo', () => {
  it('sends { hidden } and answers the whole review', async () => {
    const calls = fakeLaravel({ 'PATCH /api/admin/v1/reviews/41/photos/9': { body: { data: { ...REVIEW, photos: [{ ...PHOTO, hidden: true }] } } } })
    const answer = await admin('reviews/41/photos/9', { method: 'PATCH', body: { hidden: true, review_id: 5 } })
    expect(answer.status).toBe(200)
    const { review } = await answer.json()
    expect(review.id).toBe(41)
    expect(review.photos).toEqual([{ ...PHOTOS_OUT[0], hidden: true }])
    expect(toApi(calls)).toHaveLength(1)
    expect(toApi(calls)[0].method).toBe('PATCH')
    expect(sent(toApi(calls)[0])).toEqual({ hidden: true })
  })

  it('refuses a body without a true/false hidden, without calling the API', async () => {
    const calls = fakeLaravel({})
    for (const body of [{}, { hidden: 'true' }, { hidden: 1 }, { hidden: null }]) {
      const answer = await admin('reviews/41/photos/9', { method: 'PATCH', body })
      expect(answer.status).toBe(422)
      expect((await answer.json()).errors).toEqual({ hidden: ['Choose whether the photo is hidden from the store.'] })
    }
    expect(toApi(calls)).toEqual([])
  })

  it("passes on the API's 404 and 403 permission_denied", async () => {
    fakeLaravel({
      'PATCH /api/admin/v1/reviews/41/photos/99': { status: 404, body: { message: 'Not found.' } },
      'PATCH /api/admin/v1/reviews/41/photos/9': { status: 403, body: { message: "Your role doesn't allow this.", code: 'permission_denied', permission: 'reviews.moderate' } },
    })
    expect((await admin('reviews/41/photos/99', { method: 'PATCH', body: { hidden: false } })).status).toBe(404)
    const denied = await admin('reviews/41/photos/9', { method: 'PATCH', body: { hidden: false } })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({ message: "Your role doesn't allow this.", code: 'permission_denied', permission: 'reviews.moderate' })
  })
})

describe('the staff photo', () => {
  it('passes the bytes through with a no-store, sandboxed answer', async () => {
    const calls = fakeLaravel({ 'GET /api/admin/v1/reviews/41/photos/9': { bytes: JPEG, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000', 'Set-Cookie': 'x=1' } } })
    const answer = await admin('reviews/41/photos/9')
    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toBe('image/jpeg')
    expect(answer.headers.get('cache-control')).toBe('private, no-store')
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff')
    expect(answer.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(answer.headers.get('content-length')).toBe(String(JPEG.byteLength))
    expect(answer.headers.get('set-cookie')).toBeNull()
    expect(new Uint8Array(await answer.arrayBuffer())).toEqual(JPEG)
    // With the staff member's token, to the admin API.
    expect(toApi(calls)[0].headers.Authorization).toBe('Bearer 9|ADMIN')
  })

  it('passes PNG and WebP, and refuses any other type (502, never the bytes)', async () => {
    for (const type of ['image/png', 'image/webp']) {
      fakeLaravel({ 'GET /api/admin/v1/reviews/41/photos/9': { bytes: JPEG, headers: { 'Content-Type': type } } })
      const answer = await admin('reviews/41/photos/9')
      expect(answer.status).toBe(200)
      expect(answer.headers.get('content-type')).toBe(type)
    }
    for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream', 'image/gif']) {
      fakeLaravel({ 'GET /api/admin/v1/reviews/41/photos/9': { bytes: new TextEncoder().encode('<svg onload=alert(1)>'), headers: { 'Content-Type': type } } })
      const answer = await admin('reviews/41/photos/9')
      expect(answer.status).toBe(502)
      expect(answer.headers.get('content-type')).toBe('application/json')
    }
  })

  it('refuses a photo over 10 MB, declared or not', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1)
    fakeLaravel({ 'GET /api/admin/v1/reviews/41/photos/9': { bytes: big, headers: { 'Content-Type': 'image/png', 'Content-Length': String(big.byteLength) } } })
    expect((await admin('reviews/41/photos/9')).status).toBe(502)
    // No Content-Length: a stream that keeps going.
    const stream = () =>
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < 11; i += 1) controller.enqueue(new Uint8Array(1024 * 1024))
          controller.close()
        },
      })
    fakeLaravel({ 'GET /api/admin/v1/reviews/41/photos/9': { bytes: stream(), headers: { 'Content-Type': 'image/png' } } })
    const answer = await admin('reviews/41/photos/9')
    expect(answer.status).toBe(502)
    expect((await answer.json()).message).toBe('The file is too large to download here.')
  })

  it("passes on the API's 404 and 403, and needs the admin session", async () => {
    fakeLaravel({
      'GET /api/admin/v1/reviews/41/photos/99': { status: 404, body: { message: 'Not found.' } },
      'GET /api/admin/v1/reviews/41/photos/9': { status: 403, body: { message: "Your role doesn't allow this.", code: 'permission_denied', permission: 'reviews.view' } },
    })
    expect((await admin('reviews/41/photos/99')).status).toBe(404)
    const denied = await admin('reviews/41/photos/9')
    expect(denied.status).toBe(403)
    expect((await denied.json()).permission).toBe('reviews.view')

    const calls = fakeLaravel({ 'GET /api/admin/v1/reviews/41/photos/9': { bytes: JPEG, headers: { 'Content-Type': 'image/jpeg' } } })
    expect((await admin('reviews/41/photos/9', { cookie: null })).status).toBe(401)
    expect(calls).toEqual([])
  })

  it('only matches well-formed paths', async () => {
    const calls = fakeLaravel({})
    for (const path of ['reviews/41/photos', 'reviews/41/photos/x', 'reviews/x/photos/9', 'reviews/41/photos/9/more', 'reviews/41/files/9', 'reviews/41/photos/..%2F9']) {
      expect((await admin(path)).status).toBe(404)
    }
    expect((await admin('reviews/41/photos/9', { method: 'DELETE' })).status).toBe(404)
    expect(toApi(calls)).toEqual([])
  })
})

describe('settings → catalog', () => {
  it('reads and saves "customers can add photos to reviews"', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/settings': { body: { data: { catalog: { reviews_require_approval: true, review_photos_enabled: false } } } },
      'PATCH /api/admin/v1/settings': { body: { data: { catalog: { reviews_require_approval: true, review_photos_enabled: true } } } },
    })
    expect((await (await admin('settings')).json()).catalog).toEqual({ reviewsRequireApproval: true, reviewPhotosEnabled: false })
    const refused = await admin('settings', { method: 'PATCH', body: { catalog: { reviewPhotosEnabled: 'on' } } })
    expect(refused.status).toBe(422)
    expect((await refused.json()).errors).toEqual({ 'catalog.reviewPhotosEnabled': ['Choose whether customers can add photos to reviews.'] })
    const saved = await (await admin('settings', { method: 'PATCH', body: { catalog: { reviewPhotosEnabled: true } } })).json()
    expect(saved.catalog).toEqual({ reviewsRequireApproval: true, reviewPhotosEnabled: true })
    expect(sent(toApi(calls).at(-1))).toEqual({ catalog: { review_photos_enabled: true } })
  })
})

describe('demo mode', () => {
  it('answers 404 for the photo routes with the demo catalog, without calling anything', async () => {
    vi.stubEnv('VITE_API_PROVIDER', 'dummyjson')
    const calls = fakeLaravel({})
    expect((await admin('reviews/41/photos/9')).status).toBe(404)
    expect((await admin('reviews/41/photos/9', { method: 'PATCH', body: { hidden: true } })).status).toBe(404)
    expect(toApi(calls)).toEqual([])
  })
})
