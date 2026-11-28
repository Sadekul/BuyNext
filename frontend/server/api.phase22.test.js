// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { handleMediaRequest, mediaPath } from './mediaApi'
import { fromReview, fromReviewPhotos } from './shop/laravel'
import { normalizeProduct, normalizeReviewPhotos } from '../src/services/adapters/laravelAdapter'
import { normalizeStoreSettings } from '../src/services/adapters/contentAdapter'

/*
 * Phase 22 (docs/backend/PHASE22_CONTRACT.md §2): product reviews with photos.
 * The review route passes a form upload through unparsed (16 MB cap), review
 * photos are allow-listed wherever they reach the browser, the public catalog
 * passes `photos`, `review_photo_count` and `review_photos` on, and /media
 * serves review photos from the API's checked endpoint with a short cache.
 */

const SITE = 'https://shop.example'
const HEX = '0123456789abcdef0123456789abcdef'
const HEX2 = 'fedcba9876543210fedcba9876543210'

function fakeUpstream(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname } = new URL(url)
    calls.push({ url: String(url), path: pathname, init })
    const route = routes[`${init.method ?? 'GET'} ${pathname}`] ?? { status: 404, body: { message: 'Not found' } }
    if (route.raw !== undefined) return new Response(route.raw, { status: route.status ?? 200, headers: route.headers })
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

const BOUNDARY = '----BuyNestTest1234'
function multipart(parts) {
  const chunks = parts.map(({ name, value, filename, type }) =>
    filename
      ? `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n${value}\r\n`
      : `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  )
  return `${chunks.join('')}--${BOUNDARY}--\r\n`
}

const postReview = ({ body, contentType, cookie = 'buynest_at=AT', headers = {} }) =>
  handleApiRequest(
    new Request(`${SITE}/api/shop/products/5/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }), ...headers },
      body,
    }),
  )

const REVIEW = {
  id: 9,
  rating: 4,
  title: 'True colour',
  comment: 'The colour is exactly as shown.',
  status: 'pending',
  verified_purchase: true,
  author_name: 'Ava C.',
  created_at: '2026-11-28T10:00:00Z',
  photos: [
    { id: 1, url: `/media/reviews/${HEX}.jpg`, width: 1200, height: 1600, path: 'review-photos/9/x.jpg' },
    { id: 2, url: `/media/reviews/${HEX2}.png`, width: 800, height: 600 },
  ],
}

beforeEach(() => vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test'))
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/shop/products/:id/reviews with photos (multipart pass-through)', () => {
  it("forwards the form upload byte for byte, with its boundary and the customer's token", async () => {
    const calls = fakeUpstream({ 'POST /api/v1/products/5/reviews': { status: 201, body: { data: REVIEW } } })
    const body = multipart([
      { name: 'rating', value: '4' },
      { name: 'title', value: 'True colour' },
      { name: 'comment', value: 'The colour is exactly as shown.' },
      { name: 'photos[]', filename: 'a.jpg', type: 'image/jpeg', value: '\xff\xd8\xffJPEG' },
    ])
    const response = await postReview({ body, contentType: `multipart/form-data; boundary=${BOUNDARY}` })
    expect(response.status).toBe(201)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://laravel.test/api/v1/products/5/reviews')
    expect(calls[0].init.headers['Content-Type']).toBe(`multipart/form-data; boundary=${BOUNDARY}`)
    expect(calls[0].init.headers.Authorization).toBe('Bearer AT')
    expect(new TextDecoder().decode(calls[0].init.body)).toBe(body)
    const review = await response.json()
    expect(review.photos).toEqual([
      { id: 1, url: `/media/reviews/${HEX}.jpg`, width: 1200, height: 1600 },
      { id: 2, url: `/media/reviews/${HEX2}.png`, width: 800, height: 600 },
    ])
    expect(review.status).toBe('pending')
  })

  it('refuses a request over 16 MB before reading it, with a photos error the form can show', async () => {
    const calls = fakeUpstream({})
    const response = await postReview({ body: 'x', contentType: `multipart/form-data; boundary=${BOUNDARY}`, headers: { 'Content-Length': String(16 * 1024 * 1024 + 1) } })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      message: 'The photos are too large together (at most 16 MB).',
      errors: { photos: ['The photos are too large together (at most 16 MB).'] },
    })
    expect(calls).toHaveLength(0)
  })

  it('stops reading a body without a length as soon as it passes 16 MB', async () => {
    const calls = fakeUpstream({})
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const stream = new ReadableStream({
      pull(controller) {
        sent += 1
        if (sent > 20) controller.close()
        else controller.enqueue(chunk)
      },
    })
    const response = await handleApiRequest(
      new Request(`${SITE}/api/shop/products/5/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`, 'Sec-Fetch-Site': 'same-origin', Cookie: 'buynest_at=AT' },
        body: stream,
        duplex: 'half',
      }),
    )
    expect(response.status).toBe(422)
    expect(sent).toBeLessThanOrEqual(18)
    expect(calls).toHaveLength(0)
  })

  it('says the too-large message in Bangla for a Bangla shopper', async () => {
    fakeUpstream({})
    const response = await postReview({ body: 'x', contentType: `multipart/form-data; boundary=${BOUNDARY}`, cookie: 'buynest_at=AT; buynest_lang=bn', headers: { 'Content-Length': String(17 * 1024 * 1024) } })
    expect((await response.json()).errors.photos).toEqual(['ছবিগুলো একসঙ্গে অনেক বড় (সর্বোচ্চ ১৬ MB)।'])
  })

  it('needs the customer session (nothing is read or sent)', async () => {
    const calls = fakeUpstream({})
    const response = await postReview({ body: multipart([{ name: 'rating', value: '4' }]), contentType: `multipart/form-data; boundary=${BOUNDARY}`, cookie: null })
    expect(response.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it("passes the API's photo errors and photos_disabled code on", async () => {
    fakeUpstream({
      'POST /api/v1/products/5/reviews': {
        status: 422,
        body: { message: "Photos can't be added to reviews.", code: 'photos_disabled', errors: { photos: ["Photos can't be added to reviews."], 'photos.1': ['Only JPEG, PNG or WebP photos can be added.'] } },
      },
    })
    const response = await postReview({ body: multipart([{ name: 'rating', value: '4' }]), contentType: `multipart/form-data; boundary=${BOUNDARY}` })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      message: "Photos can't be added to reviews.",
      code: 'photos_disabled',
      errors: { photos: ["Photos can't be added to reviews."], 'photos.1': ['Only JPEG, PNG or WebP photos can be added.'] },
    })
  })

  it('keeps the JSON path exactly as before (only the three fields, parsed and trimmed)', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/products/5/reviews': { status: 201, body: { data: { ...REVIEW, photos: [] } } } })
    const response = await postReview({ body: JSON.stringify({ rating: 4, title: ' Hi ', comment: ' Nice and soft. ', photos: ['x'] }), contentType: 'application/json' })
    expect(response.status).toBe(201)
    expect(calls[0].init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(calls[0].init.body)).toEqual({ rating: 4, title: 'Hi', comment: 'Nice and soft.' })
    expect((await response.json()).photos).toEqual([])
  })
})

describe('review photo allow-list (BFF fromReview and the storefront adapter)', () => {
  const RAW = [
    { id: 1, url: `/media/reviews/${HEX}.webp`, width: 1600, height: 900 },
    { id: 2, url: `https://evil.example/media/reviews/${HEX}.jpg`, width: 1, height: 1 },
    { id: 3, url: `/media/reviews/${HEX}.svg`, width: 1, height: 1 },
    { id: 4, url: `/media/reviews/../${HEX}.jpg` },
    { id: 5, url: `/media/products/1/${HEX}.jpg` },
    { id: 6, url: `/media/reviews/${HEX.toUpperCase()}.jpg` },
    { id: 7, url: `javascript:alert(1)` },
    { id: '8', url: `/media/reviews/${HEX2}.jpg`, width: -4, height: 'big' },
    null,
    'text',
  ]
  const EXPECTED = [
    { id: 1, url: `/media/reviews/${HEX}.webp`, width: 1600, height: 900 },
    { id: null, url: `/media/reviews/${HEX2}.jpg`, width: null, height: null },
  ]

  it('keeps only /media/reviews/<32 hex>.<jpg|png|webp> photos, with whole positive sizes', () => {
    expect(fromReviewPhotos(RAW)).toEqual(EXPECTED)
    expect(normalizeReviewPhotos(RAW)).toEqual(EXPECTED)
  })

  it('gives [] for a review without photos or with a broken list', () => {
    expect(fromReview({ id: 1 }).photos).toEqual([])
    expect(fromReview({ id: 1, photos: 'x' }).photos).toEqual([])
    expect(normalizeReviewPhotos(undefined)).toEqual([])
  })

  it('keeps at most 3 photos', () => {
    const many = [HEX, HEX2, HEX, HEX2].map((hex, index) => ({ id: index + 1, url: `/media/reviews/${hex}.jpg`, width: 10, height: 10 }))
    expect(fromReviewPhotos(many)).toHaveLength(3)
    expect(normalizeReviewPhotos(many)).toHaveLength(3)
  })
})

describe('the public catalog passes the phase 22 fields on (proxy)', () => {
  const catalog = (path) => handleApiRequest(new Request(`${SITE}/api/catalog/${path}`, { headers: { 'Sec-Fetch-Site': 'same-origin' } }))

  it('product detail: review photos and review_photo_count reach the adapter', async () => {
    fakeUpstream({ 'GET /api/v1/products/5': { body: { data: { id: 5, name: 'Tee', price: '20.00', reviews: [REVIEW], review_photo_count: 2 } } } })
    const response = await catalog('products/5')
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.review_photo_count).toBe(2)
    expect(data.reviews[0].photos).toHaveLength(2)
    const product = normalizeProduct(data)
    expect(product.reviewPhotoCount).toBe(2)
    expect(product.reviews[0].photos).toEqual([
      { id: 1, url: `/media/reviews/${HEX}.jpg`, width: 1200, height: 1600 },
      { id: 2, url: `/media/reviews/${HEX2}.png`, width: 800, height: 600 },
    ])
  })

  it('reviewPhotoCount is a whole number ≥ 0, 0 when absent', () => {
    expect(normalizeProduct({ id: 1, name: 'x', price: '1' }).reviewPhotoCount).toBe(0)
    expect(normalizeProduct({ id: 1, name: 'x', price: '1', review_photo_count: -2 }).reviewPhotoCount).toBe(0)
    expect(normalizeProduct({ id: 1, name: 'x', price: '1', review_photo_count: '3' }).reviewPhotoCount).toBe(0)
    expect(normalizeProduct({ id: 1, name: 'x', price: '1', review_photo_count: 4 }).reviewPhotoCount).toBe(4)
  })

  it('store info: review_photos reaches the adapter as reviewPhotos, off by default', async () => {
    fakeUpstream({ 'GET /api/v1/store': { body: { data: { store_name: 'BuyNest', review_photos: { enabled: true, max: 3, max_megabytes: 5 } } } } })
    const { data } = await (await catalog('store')).json()
    expect(data.review_photos).toEqual({ enabled: true, max: 3, max_megabytes: 5 })
    expect(normalizeStoreSettings({ data }).reviewPhotos).toEqual({ enabled: true, max: 3, maxMegabytes: 5 })
    expect(normalizeStoreSettings({ data: {} }).reviewPhotos).toEqual({ enabled: false, max: 3, maxMegabytes: 5 })
    expect(normalizeStoreSettings({ data: { review_photos: { enabled: 'yes', max: 0, max_megabytes: 'x' } } }).reviewPhotos).toEqual({ enabled: false, max: 3, maxMegabytes: 5 })
  })
})

describe('review photos at /media/reviews/* (server/mediaApi.js)', () => {
  const media = (path, method = 'GET') => handleMediaRequest(new Request(`${SITE}${path}`, { method }))

  it("fetches the API's checked endpoint and caches for five minutes only", async () => {
    const calls = fakeUpstream({ [`GET /api/v1/review-photos/${HEX}.jpg`]: { raw: 'JPEG-bytes', headers: { 'Content-Type': 'text/html', 'Content-Length': '10' } } })
    const response = await media(`/media/reviews/${HEX}.jpg`)
    expect(response.status).toBe(200)
    expect(calls[0].url).toBe(`http://laravel.test/api/v1/review-photos/${HEX}.jpg`)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(await response.text()).toBe('JPEG-bytes')
  })

  it("sends the sign-in service's shared key (the review photo endpoint is an API route)", async () => {
    vi.stubEnv('BUYNEST_BFF_KEY', 'shared-key')
    const calls = fakeUpstream({ [`GET /api/v1/review-photos/${HEX}.png`]: { raw: 'PNG' } })
    await media(`/media/reviews/${HEX}.png`)
    expect(calls[0].init.headers['X-BuyNest-Bff']).toBe('shared-key')
  })

  it("keeps the API's 404 (pending, hidden or unknown photo) a 404 that isn't cached", async () => {
    fakeUpstream({})
    const response = await media(`/media/reviews/${HEX}.webp`)
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('product photos keep their one-year cache', async () => {
    fakeUpstream({ [`GET /storage/products/12/${HEX}.webp`]: { raw: 'RIFF' } })
    expect((await media(`/media/products/12/${HEX}.webp`)).headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it.each([
    '/media/reviews/../x',
    `/media/reviews/${HEX}.svg`,
    `/media/reviews/${HEX}-320.webp`,
    `/media/reviews/1/${HEX}.jpg`,
    `/media/reviews/${HEX.toUpperCase()}.jpg`,
    `/media/reviews/%2e%2e/${HEX}.jpg`,
    `/media/reviews/${HEX}.jpg/extra`,
    '/media/reviews/',
  ])('answers 404 for %s without asking the API', async (path) => {
    const calls = fakeUpstream({})
    expect((await media(path)).status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('also accepts the path a host rewrite produces (/api/media/reviews/…)', () => {
    expect(mediaPath(`/api/media/reviews/${HEX}.jpg`)).toBe(`reviews/${HEX}.jpg`)
  })
})
