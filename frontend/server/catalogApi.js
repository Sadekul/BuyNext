import { json, laravel, pick } from './http.js'

/*
 * BuyNest catalog, at /api/catalog/* (storefront, VITE_API_PROVIDER=laravel).
 * A read-only window onto the Laravel API's public catalog, on the
 * storefront's own address: no CORS, and no API address in the browser bundle.
 *
 *   GET /api/catalog/products?…     → GET /api/v1/products?…   ({ data, meta })
 *   GET /api/catalog/products/:id   → GET /api/v1/products/:id ({ data })
 *   GET /api/catalog/categories     → GET /api/v1/categories   ({ data })
 *
 * Only these paths and the query keys below are forwarded (an allow-list), so
 * the service can't be used to reach anything else on the API. Answers are
 * public and may be cached for a minute by the browser and the host's CDN.
 */

const QUERY_KEYS = ['search', 'category', 'brand[]', 'min_price', 'max_price', 'min_rating', 'available', 'sort', 'direction', 'page', 'per_page']
const MAX_VALUE_LENGTH = 100
const CACHE = 'public, max-age=60'

const isId = (value) => /^\d{1,9}$/.test(value ?? '')

function forwardedQuery(url) {
  const params = new URLSearchParams()
  for (const key of QUERY_KEYS) {
    for (const value of url.searchParams.getAll(key).slice(0, 20)) params.append(key, value.slice(0, MAX_VALUE_LENGTH))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

/** /api/catalog/<segments> → the Laravel path, or null. */
function upstreamPath(segments, url) {
  const [resource, id, ...rest] = segments
  if (rest.length > 0) return null
  if (resource === 'products' && id === undefined) return `/api/v1/products${forwardedQuery(url)}`
  if (resource === 'products' && isId(id)) return `/api/v1/products/${id}`
  if (resource === 'categories' && id === undefined) return '/api/v1/categories'
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
  const body = { data: data?.data ?? null, ...(data?.meta && { meta: pick(data.meta, ['current_page', 'per_page', 'total', 'last_page', 'from', 'to']) }) }
  const response = json(body)
  response.headers.set('Cache-Control', CACHE)
  return response
}
