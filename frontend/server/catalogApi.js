import { json, laravel, pick } from './http.js'

/*
 * BuyNest catalog, at /api/catalog/* (storefront, VITE_API_PROVIDER=laravel).
 * A read-only window onto the Laravel API's public catalog, on the
 * storefront's own address: no CORS, and no API address in the browser bundle.
 *
 *   GET /api/catalog/products?…     → GET /api/v1/products?…   ({ data, meta })
 *   GET /api/catalog/products/:id   → GET /api/v1/products/:id ({ data })
 *   GET /api/catalog/categories     → GET /api/v1/categories   ({ data })
 *   GET /api/catalog/home           → GET /api/v1/home         ({ data: { hero, banners, featured_products } })
 *   GET /api/catalog/pages/:slug    → GET /api/v1/pages/:slug  ({ data }, published pages only)
 *   GET /api/catalog/store          → GET /api/v1/store        ({ data }: shipping, countries, payment, tax rules)
 *   GET /api/catalog/redirects?path=/old → GET /api/v1/redirects?path=/old ({ data: { from_path, to_path, status_code } }, or 404)
 *                                        the admin's URL redirects, checked by the storefront's "not found" page (phase 7)
 *   GET /api/catalog/products/compare?ids=1,2,3 → GET /api/v1/products/compare?ids=1,2,3 (phase 11: 2–4 products side by side)
 * These pass the API's `data` on unchanged (snake_case); the storefront's adapter maps it.
 * Phase 10: a search the API corrected ("ihpone" → "iphone") says so in `meta.corrected_query`.
 *
 * Only these paths and the query keys below are forwarded (an allow-list), so
 * the service can't be used to reach anything else on the API. Answers are
 * public and may be cached for a minute by the browser and the host's CDN.
 */

// `correct=0` (phase 10): search the words exactly as typed, without typo correction.
const QUERY_KEYS = ['search', 'correct', 'suggest', 'category', 'brand[]', 'min_price', 'max_price', 'min_rating', 'available', 'sort', 'direction', 'page', 'per_page']
const MAX_VALUE_LENGTH = 100
const CACHE = 'public, max-age=60'

const isId = (value) => /^\d{1,9}$/.test(value ?? '')
const isSlug = (value) => /^[a-z0-9-]{1,80}$/.test(value ?? '')

function forwardedQuery(url) {
  const params = new URLSearchParams()
  for (const key of QUERY_KEYS) {
    for (const value of url.searchParams.getAll(key).slice(0, 20)) params.append(key, value.slice(0, MAX_VALUE_LENGTH))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

/** Phase 7: ?path=/old-page (a store path, no query or fragment needed) → the API's lookup, or null. */
function redirectLookup(url) {
  const path = url.searchParams.get('path') ?? ''
  if (!/^\/[^\s]{0,511}$/.test(path)) return null
  return `/api/v1/redirects?${new URLSearchParams({ path })}`
}

/** Phase 11: ?ids=1,2,3 (2 to 4 product ids; the API checks the count and says so) → the compare path, or null. */
function compareLookup(url) {
  const ids = (url.searchParams.get('ids') ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  if (ids.length === 0 || ids.length > 4 || !ids.every(isId)) return null
  return `/api/v1/products/compare?${new URLSearchParams({ ids: ids.join(',') })}`
}

/** /api/catalog/<segments> → the Laravel path, or null. */
function upstreamPath(segments, url) {
  const [resource, id, ...rest] = segments
  if (rest.length > 0) return null
  if (resource === 'products' && id === 'compare') return compareLookup(url)
  if (resource === 'products' && id === undefined) return `/api/v1/products${forwardedQuery(url)}`
  if (resource === 'products' && isId(id)) return `/api/v1/products/${id}`
  if (resource === 'categories' && id === undefined) return '/api/v1/categories'
  if ((resource === 'home' || resource === 'store') && id === undefined) return `/api/v1/${resource}`
  if (resource === 'pages' && isSlug(id)) return `/api/v1/pages/${id}`
  if (resource === 'redirects' && id === undefined) return redirectLookup(url)
  return null
}

export async function handleCatalogRequest(request, segments) {
  const path = upstreamPath(segments, new URL(request.url))
  if (!path) return json({ message: 'Not found.' }, 404)
  if (request.method !== 'GET') {
    const response = json({ message: 'The catalog is read-only.' }, 405)
    response.headers.set('Allow', 'GET')
    return response
  }

  const { status, data } = await laravel(path, { request })
  if (status !== 200) return json({ message: data?.message ?? 'The catalog could not be loaded.' }, status)
  // Only the documented keys: Laravel's `links`, `meta.links`, and `meta.path` hold the API's internal address.
  const body = { data: data?.data ?? null, ...(data?.meta && { meta: pick(data.meta, ['current_page', 'per_page', 'total', 'last_page', 'from', 'to', 'redirect_url', 'corrected_query']) }) }
  const response = json(body)
  response.headers.set('Cache-Control', CACHE)
  return response
}
