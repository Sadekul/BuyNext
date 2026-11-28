/*
 * apiClient — the ONLY place that talks to the network.
 * Every service (products, categories, auth, orders) goes through it,
 * so base URL, headers, cookies, timeouts, and errors are handled once.
 */
import { apiProvider } from './providers'
import { currentLanguage, translate } from '../i18n'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '')

// Providers on this site's own address (Laravel, through /api/catalog) need no API address.
if (!API_BASE_URL && !apiProvider.request.sameOrigin) {
  throw new Error('VITE_API_BASE_URL is not set. Copy frontend/.env.example to frontend/.env.local.')
}

const DEFAULT_TIMEOUT_MS = 15_000

// Phase 13: in the shopper's language (locales/<lang>/errors.json `api.*`). 419 = Laravel CSRF mismatch, 422 = validation.
const STATUS_CODES = [400, 401, 403, 404, 419, 422, 429]
const statusMessage = (status) => (STATUS_CODES.includes(status) ? translate(`errors:api.${status}`) : null)

/**
 * Error thrown for failed requests. `status` is 0 for network/timeout failures.
 * `fieldErrors` holds per-field validation messages (Laravel 422:
 * `{ message, errors: { "shipping_address.city": ["…"] } }`), or null.
 */
export class ApiError extends Error {
  constructor(message, { status = 0, data = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
    this.fieldErrors = status === 422 && data?.errors && typeof data.errors === 'object' ? data.errors : null
  }
}

/** Reads a cookie value (used for Laravel's XSRF-TOKEN). */
function readCookie(name) {
  const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith(`${name}=`))
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null
}

/** True when a request was cancelled on purpose (e.g. the component unmounted). */
export function isAbortError(error) {
  return error?.name === 'AbortError'
}

/**
 * One signal that aborts when ANY input signal aborts. Uses AbortSignal.any
 * where available (Chrome 116+, Firefox 124+, Safari 17.4+) and a manual
 * fallback for older browsers.
 */
function anySignal(signals) {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

const timeoutMessage = () => translate('errors:api.timeout')

/**
 * Builds `${base}${path}?a=1&b=2`, skipping empty parameters. `sameOrigin`
 * requests go to this site itself (the services at /api: sign-in, catalog, shop).
 */
function buildUrl(path, params = {}, sameOrigin = false) {
  const url = sameOrigin ? new URL(path, window.location.origin) : new URL(`${API_BASE_URL}${path}`)
  // Phase 13: the public catalog is fetched without cookies (and cached by URL), so it names
  // the language in the URL: `lang=bn` (no parameter = English, as before).
  if (path.startsWith('/api/catalog/') && currentLanguage() === 'bn') url.searchParams.set('lang', 'bn')
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }
  return url
}

async function request(
  path,
  { method = 'GET', params, body, headers, signal, sameOrigin = false, keepalive = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  // Cancel when the caller aborts OR when the request takes too long.
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combinedSignal = signal ? anySignal([signal, timeoutSignal]) : timeoutSignal

  // Cookie-based auth (Laravel Sanctum) needs credentials + a CSRF header on writes.
  // Requests that ask for `sameOrigin` carry this site's own cookies (the
  // sign-in session). A same-origin PROVIDER (the public catalog) needs none.
  const { credentials: providerCredentials = 'omit', xsrfCookie, sameOrigin: providerSameOrigin = false } = apiProvider.request
  const credentials = sameOrigin ? 'same-origin' : providerCredentials
  const xsrfToken = xsrfCookie && method !== 'GET' && !sameOrigin ? readCookie(xsrfCookie) : null

  // Phase 22: a FormData body (a review's photos) is sent as it is: the browser writes the
  // multipart Content-Type with its boundary itself, so none is set here.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData

  let response
  try {
    response = await fetch(buildUrl(path, params, sameOrigin || providerSameOrigin), {
      method,
      credentials,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && !isForm && { 'Content-Type': 'application/json' }),
        ...(xsrfToken && { 'X-XSRF-TOKEN': xsrfToken }),
        ...headers,
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: combinedSignal,
      keepalive, // true: the request finishes even if the page is closed or reloaded
    })
  } catch (error) {
    // fetch() only rejects when no HTTP response arrived at all.
    if (error.name === 'TimeoutError') throw new ApiError(timeoutMessage())
    if (isAbortError(error)) throw error // cancelled on purpose: not a real failure
    throw new ApiError(translate('errors:api.network'))
  }

  const isJson = response.headers.get('content-type')?.includes('application/json')
  let data = null
  if (isJson) {
    try {
      data = await response.json()
    } catch (error) {
      if (isAbortError(error)) throw error
      if (error.name === 'TimeoutError') throw new ApiError(timeoutMessage())
      throw new ApiError(translate('errors:api.unreadable'), { status: response.status })
    }
  }

  // fetch() does NOT reject on 4xx/5xx — we must check response.ok ourselves.
  if (!response.ok) {
    const fallback = translate(response.status >= 500 ? 'errors:api.server' : 'errors:api.failed')
    throw new ApiError(data?.message ?? statusMessage(response.status) ?? fallback, {
      status: response.status,
      data,
    })
  }

  // Every BuyNest endpoint returns JSON; anything else (e.g. an HTML error
  // page from a proxy) would crash the adapters, so treat it as an error.
  if (!isJson) {
    throw new ApiError(translate('errors:api.unexpected'), { status: response.status })
  }

  return data
}

export const apiClient = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
}
