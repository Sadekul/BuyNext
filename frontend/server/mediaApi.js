/*
 * Product photos uploaded in the admin (phase 5), at /media/* on the
 * storefront's own address:
 *
 *   GET /media/products/:id/:file  → Laravel's /storage/products/:id/:file
 *
 * Every image stays on the store's origin, so the Content-Security-Policy
 * needs no API address and the browser never learns where the API lives.
 *
 * Only names the API itself gives uploads are allowed (an allow-list:
 * `products/<id>/<32 hex>.<jpg|png|webp>`, and since phase 9 the resized
 * copies the API makes next to it, `<32 hex>-320.webp` and `<32 hex>-960.webp`);
 * anything else is a 404, so this can't be used to read other files from the
 * API's storage. The type comes
 * from the extension, never from the upstream answer. File names are random
 * and never reused, so the browser and the CDN may keep them for a year.
 *
 * Phase 22: customers' review photos, `reviews/<32 hex>.<jpg|png|webp>`, come
 * from the API's `GET /api/v1/review-photos/<name>` instead (never from
 * /storage: they are private until a moderator approves the review, and the
 * API answers 404 for a pending, rejected or hidden one). They are cached for
 * five minutes only (never `immutable`), so a photo staff hide disappears
 * from the store soon after. That call is an API route, so it carries the
 * sign-in service's shared key like every other API call (server/http.js).
 *
 * Runs in `npm run dev` / `npm run preview` (vite.config.js), as a Vercel
 * function (api/media, with the /media rewrite in vercel.json) and as a
 * Netlify function (netlify/functions/media.mjs).
 */

import { bffHeaders } from './http.js'

const MEDIA_PATH = /^products\/\d{1,9}\/[a-f0-9]{32}(-(320|960))?\.(jpg|png|webp)$/
const REVIEW_PATH = /^reviews\/([a-f0-9]{32}\.(jpg|png|webp))$/
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const CACHE = 'public, max-age=31536000, immutable'
const REVIEW_CACHE = 'public, max-age=300'
const MAX_BYTES = 10 * 1024 * 1024 // uploads are at most 5 MB

const laravelBase = () => (process.env.BUYNEST_LARAVEL_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

const notFound = () =>
  new Response('Not found.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })

/** "/media/products/1/<hex>.jpg" (or "/api/media/…" after a host rewrite) → "products/1/<hex>.jpg", or null. */
export function mediaPath(pathname) {
  const match = /^\/(?:api\/)?media\/(.+)$/.exec(pathname)
  return match && (MEDIA_PATH.test(match[1]) || REVIEW_PATH.test(match[1])) ? match[1] : null
}

/** Where an allowed path is fetched from, and how long it may be cached. */
function source(path, request) {
  const review = REVIEW_PATH.exec(path)
  if (review) return { url: `${laravelBase()}/api/v1/review-photos/${review[1]}`, headers: bffHeaders(request), cache: REVIEW_CACHE }
  return { url: `${laravelBase()}/storage/${path}`, headers: {}, cache: CACHE }
}

export async function handleMediaRequest(request) {
  const path = mediaPath(new URL(request.url).pathname)
  if (!path || !['GET', 'HEAD'].includes(request.method)) return notFound()

  const { url, headers: upstreamHeaders, cache } = source(path, request)
  let upstream
  try {
    upstream = await fetch(url, { headers: upstreamHeaders, signal: AbortSignal.timeout(15_000) })
  } catch {
    return new Response('The image could not be loaded.', { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
  const length = Number(upstream.headers.get('content-length') ?? 0)
  if (!upstream.ok || length > MAX_BYTES) {
    await upstream.body?.cancel()
    return notFound()
  }

  const headers = new Headers({
    'Content-Type': TYPES[path.slice(path.lastIndexOf('.') + 1)],
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  })
  if (length > 0) headers.set('Content-Length', String(length))
  if (request.method === 'HEAD') {
    await upstream.body?.cancel()
    return new Response(null, { status: 200, headers })
  }
  return new Response(upstream.body, { status: 200, headers })
}
