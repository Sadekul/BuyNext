/*
 * apiClient — the ONLY place that talks to the network.
 * Every service (products, categories, auth, orders) goes through it,
 * so base URL, headers, cookies, timeouts, and errors are handled once.
 */
import { apiProvider } from './providers'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '')

// Providers on this site's own address (Laravel, through /api/catalog) need no API address.
if (!API_BASE_URL && !apiProvider.request.sameOrigin) {
  throw new Error('VITE_API_BASE_URL is not set. Copy frontend/.env.example to frontend/.env.local.')
}

const DEFAULT_TIMEOUT_MS = 15_000

const STATUS_MESSAGES = {
  400: 'The request was invalid.',
  401: 'Please sign in to continue.',
  403: "You don't have permission to do that.",
  404: "We couldn't find what you were looking for.",
  419: 'Your session expired. Please refresh the page and try again.', // Laravel CSRF mismatch
  422: 'Please check the highlighted fields.', // Laravel validation
  429: 'Too many requests. Please wait a moment and try again.',
}

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

const TIMEOUT_MESSAGE = 'The server took too long to respond. Please try again.'

/**
 * Builds `${base}${path}?a=1&b=2`, skipping empty parameters. `sameOrigin`
 * requests go to this site itself (the services at /api: sign-in, catalog, shop).
 */
function buildUrl(path, params = {}, sameOrigin = false) {
  const url = sameOrigin ? new URL(path, window.location.origin) : new URL(`${API_BASE_URL}${path}`)
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

  let response
  try {
    response = await fetch(buildUrl(path, params, sameOrigin || providerSameOrigin), {
      method,
      credentials,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(xsrfToken && { 'X-XSRF-TOKEN': xsrfToken }),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: combinedSignal,
      keepalive, // true: the request finishes even if the page is closed or reloaded
    })
  } catch (error) {
    // fetch() only rejects when no HTTP response arrived at all.
    if (error.name === 'TimeoutError') throw new ApiError(TIMEOUT_MESSAGE)
    if (isAbortError(error)) throw error // cancelled on purpose: not a real failure
    throw new ApiError('Network error. Check your internet connection and try again.')
  }

  const isJson = response.headers.get('content-type')?.includes('application/json')
  let data = null
  if (isJson) {
    try {
      data = await response.json()
    } catch (error) {
      if (isAbortError(error)) throw error
      if (error.name === 'TimeoutError') throw new ApiError(TIMEOUT_MESSAGE)
      throw new ApiError('The server sent a response we could not read.', { status: response.status })
    }
  }

  // fetch() does NOT reject on 4xx/5xx — we must check response.ok ourselves.
  if (!response.ok) {
    const fallback = response.status >= 500 ? 'The server had a problem. Please try again later.' : 'Request failed.'
    throw new ApiError(data?.message ?? STATUS_MESSAGES[response.status] ?? fallback, {
      status: response.status,
      data,
    })
  }

  // Every BuyNest endpoint returns JSON; anything else (e.g. an HTML error
  // page from a proxy) would crash the adapters, so treat it as an error.
  if (!isJson) {
    throw new ApiError('The server sent an unexpected response.', { status: response.status })
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
